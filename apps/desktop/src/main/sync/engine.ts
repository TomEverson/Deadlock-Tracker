import type { CompiledQuery } from 'kysely'
import { trimMetadata, type PlayerProfile } from '@deadlock/core/domain/matches/services/trim-metadata'
import { toPlayerMatchRow, type HistoryEntry } from '@deadlock/core/domain/players/services/match-rows'
import { DeadlockGc, GcError, type GcErrorCode } from '@deadlock/core/steam/gc'
import { downloadMatchMetadata } from '@deadlock/core/steam/match-metadata'
import { db } from '../db'
import { fetchSteamProfiles, fetchPlayerRanks } from '../services/deadlock-api'
import { getRefreshToken, saveRefreshToken, setSteamAccount } from '../steam/account'
import { backoffUntil, budgetLeft, recordRequest, startBackoff } from './state'

// One sync run: Steam logon → Game Coordinator → friends list → match
// histories → log off, writing to the app's local database. Match details are
// not part of a sync; they are downloaded per match, on demand.

const MAX_PAGES = 60
const NO_MATCHES_RECHECK_MS = 7 * 24 * 60 * 60 * 1000
// After these, nothing else is worth trying this session.
const SESSION_OVER: GcErrorCode[] = ['in_game', 'login', 'timeout']

export interface SyncProgress {
  step: string
  done?: number
  total?: number
}

export interface SyncOptions {
  /** Only this account (else you + all Steam friends). */
  target?: number | null
  /** Re-read whole histories. */
  full?: boolean
}

export interface SyncResult {
  selfAccountId: number
  players: number
  newMatches: number
  /** New matches per account (for notifications). */
  newByAccount: Record<number, number>
  /** Why the run stopped early, if it did (budget, rate limit, in game…). */
  stoppedBecause: string | null
  errors: string[]
}

/** Lets the cloud supply match details before we spend Steam requests (Phase 5). */
export interface DetailsSource {
  /** Pull whatever of `matchIds` the cloud has into the local DB; returns the ids it supplied. */
  pull(matchIds: number[]): Promise<Set<number>>
}

export class SyncAbort extends Error {}

async function runCompiled(queries: CompiledQuery[]): Promise<void> {
  if (queries.length === 0) return
  await db()
    .transaction()
    .execute(async (trx) => {
      for (const q of queries) await trx.executeQuery(q)
    })
}

// ------------------------------------------------------------------ targets

async function everyoneToSync(gc: DeadlockGc, self: number): Promise<number[]> {
  const known = await db()
    .selectFrom('player')
    .leftJoin('playerMatch', 'playerMatch.accountId', 'player.accountId')
    .select(['player.accountId', 'player.lastSyncedAt', (eb) => eb.fn.count<number>('playerMatch.matchId').as('matchCount')])
    .groupBy('player.accountId')
    .orderBy('player.lastViewedAt', 'desc')
    .execute()

  const friends = await gc.getFriendAccountIds()
  if (!friends) return [self, ...known.map((p) => p.accountId).filter((id) => id !== self)]
  await saveFriends(gc, friends)

  const friendSet = new Set(friends)
  const knownById = new Map(known.map((p) => [p.accountId, p]))
  const cutoff = Date.now() - NO_MATCHES_RECHECK_MS
  // Friends whose last sync found no matches at all don't play Deadlock; re-check weekly.
  const inactive = (id: number) => {
    const p = knownById.get(id)
    return !!p?.lastSyncedAt && Number(p.matchCount) === 0 && Date.parse(p.lastSyncedAt) > cutoff
  }
  const knownFriends = known.map((p) => p.accountId).filter((id) => id !== self && friendSet.has(id))
  const newFriends = friends.filter((id) => id !== self && !knownById.has(id))
  return [self, ...[...knownFriends, ...newFriends].filter((id) => !inactive(id))]
}

async function saveFriends(gc: DeadlockGc, friends: number[]): Promise<void> {
  const profiles = await gc.getProfiles(friends)
  const now = new Date().toISOString()
  const d = db()
  await runCompiled(
    friends.flatMap((accountId) => {
      const p = profiles.get(accountId)
      return [
        d.insertInto('player').values({ accountId, createdAt: now }).onConflict((oc) => oc.column('accountId').doNothing()).compile(),
        d
          .updateTable('player')
          .set({ isFriend: 1, ...(p?.name ? { personaName: p.name } : {}), ...(p?.avatar ? { avatarUrl: p.avatar } : {}) })
          .where('accountId', '=', accountId)
          .compile(),
      ]
    }),
  )
  const stale = d.updateTable('player').set({ isFriend: 0 }).where('isFriend', '=', 1)
  await (friends.length > 0 ? stale.where('accountId', 'not in', friends) : stale).execute()
}

/**
 * Refresh the Steam friend list, names and avatars without syncing matches.
 * The friends list arrives with the normal Steam logon and personas are
 * batched over that same connection, so this spends none of the Game
 * Coordinator history/detail quota. Safe to run while Steam is rate-limiting
 * history requests (that pause only covers GC requests).
 */
export async function refreshFriends(): Promise<number> {
  const token = await getRefreshToken()
  if (!token) return 0
  const gc = new DeadlockGc((t) => void saveRefreshToken(t))
  try {
    await gc.connect(token, { checkPlayingState: false })
    const friends = await gc.getFriendAccountIds()
    if (!friends) return 0
    await saveFriends(gc, friends)
    await updatePlayerRanks([gc.accountId, ...friends])
    return friends.length
  } finally {
    gc.disconnect()
  }
}

// ------------------------------------------------------------------ history

/** Returns new match count, or throws. Sets `stop` when budget/rate limit ends the run. */
async function syncAccount(gc: DeadlockGc, accountId: number, self: number, opts: SyncOptions, flags: { stop: string | null }): Promise<number> {
  const d = db()
  const known = new Set((await d.selectFrom('playerMatch').select('matchId').where('accountId', '=', accountId).execute()).map((r) => r.matchId))
  // Everything at or before the watermark is known to be stored (see docs).
  const existing = await d.selectFrom('player').select('historyVerifiedUntil').where('accountId', '=', accountId).executeTakeFirst()
  const watermark = opts.full ? null : (existing?.historyVerifiedUntil ?? null)

  const fetched: HistoryEntry[] = []
  let cursor: string | null = null
  let complete = true
  for (let page = 0; page < MAX_PAGES; page++) {
    if ((await budgetLeft('history')) === 0) {
      flags.stop = "Reached the app's request cap for Steam history. It continues as older requests age out."
      complete = false
      break
    }
    await recordRequest('history')
    let result
    try {
      result = await gc.getMatchHistoryPage(accountId, cursor)
    } catch (err) {
      if (err instanceof GcError && err.code === 'rate_limited') {
        await startBackoff()
        flags.stop = 'Steam rate-limited history requests. Pausing Steam requests for 2 hours.'
        if (fetched.length === 0) throw err
        complete = false
        break
      }
      throw err
    }
    fetched.push(...result.matches)
    if (watermark !== null && result.matches.some((m) => m.start_time <= watermark)) break
    if (!result.cursor) break
    cursor = result.cursor
    if (page === MAX_PAGES - 1) complete = false
  }

  const profile = await gc.getProfile(accountId)
  const fresh = fetched.filter((m) => !known.has(m.match_id))
  const now = new Date().toISOString()
  const newestFetched = fetched.reduce<number | null>((max, m) => (max === null || m.start_time > max ? m.start_time : max), null)
  const verifiedUntil = complete ? (newestFetched ?? watermark) : (existing?.historyVerifiedUntil ?? null)

  await runCompiled([
    ...fresh.map((m) =>
      d
        .insertInto('playerMatch')
        .values(toPlayerMatchRow(accountId, m))
        .onConflict((oc) => oc.columns(['accountId', 'matchId']).doNothing())
        .compile(),
    ),
    d.insertInto('player').values({ accountId, createdAt: now }).onConflict((oc) => oc.column('accountId').doNothing()).compile(),
    d
      .updateTable('player')
      .set({
        lastSyncedAt: now,
        historyVerifiedUntil: verifiedUntil,
        ...(profile.name ? { personaName: profile.name } : {}),
        ...(profile.avatar ? { avatarUrl: profile.avatar } : {}),
        profileUrl: `https://steamcommunity.com/profiles/${(76561197960265728n + BigInt(accountId)).toString()}/`,
        ...(accountId === self ? { isSelf: 1 } : {}),
      })
      .where('accountId', '=', accountId)
      .compile(),
    d.insertInto('syncLog').values({ accountId, trigger: opts.full ? 'app-full' : 'app', status: 'ok', newMatches: fresh.length, error: null, createdAt: now }).compile(),
  ])
  if (accountId === self) {
    await d.updateTable('player').set({ isSelf: 0 }).where('accountId', '!=', self).execute()
    await setSteamAccount({ accountId: self, name: profile.name })
  }
  return fresh.length
}

// ------------------------------------------------------------------ details

const deadlockApiProfiles = async (ids: number[]) => {
  const out = new Map<number, PlayerProfile>()
  const rows = await fetchSteamProfiles(ids).catch(() => [])
  for (const p of rows) if (p.personaname) out.set(p.account_id, { name: p.personaname, avatar: p.avatarmedium ?? null })
  return out
}

/** Names for a match's players: Steam personas, then the local player table, then deadlock-api. */
async function resolveProfiles(gc: DeadlockGc, accountIds: number[]): Promise<Map<number, PlayerProfile>> {
  const out = new Map<number, PlayerProfile>()
  for (const [id, p] of await gc.getProfiles(accountIds)) if (p.name) out.set(id, p)
  let missing = accountIds.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const rows = await db().selectFrom('player').select(['accountId', 'personaName', 'avatarUrl']).where('accountId', 'in', missing).execute()
    for (const r of rows) if (r.personaName) out.set(r.accountId, { name: r.personaName, avatar: r.avatarUrl })
    missing = missing.filter((id) => !out.has(id))
  }
  if (missing.length > 0) for (const [id, p] of await deadlockApiProfiles(missing)) out.set(id, p)
  return out
}

export async function fetchAndStoreMatchDetail(gc: DeadlockGc, matchId: number): Promise<void> {
  await recordRequest('details')
  const salts = await gc.getMatchSalts(matchId)
  const meta = await downloadMatchMetadata(salts)
  const detail = trimMetadata(meta, await resolveProfiles(gc, meta.players.map((p) => p.account_id)))
  const data = JSON.stringify(detail)
  const fetchedAt = new Date().toISOString()
  await db()
    .insertInto('matchDetail')
    .values({ matchId: detail.matchId, data, fetchedAt })
    .onConflict((oc) => oc.column('matchId').doUpdateSet({ data, fetchedAt }))
    .execute()
  await db().deleteFrom('matchDetailAttempt').where('matchId', '=', matchId).execute()
}

/**
 * Fill in stored rank badges from deadlock-api's batch rank endpoint. This is
 * a community API request, not Steam, so it doesn't touch the GC quota. Badge
 * 0 means "no recent ranked match reports a rank"; leave the stored value
 * alone then, and the UI shows Unranked when nothing is known.
 */
async function updatePlayerRanks(accountIds: number[]): Promise<void> {
  if (accountIds.length === 0) return
  try {
    const ranks = await fetchPlayerRanks(accountIds)
    const updates = ranks.filter((r) => r.badge > 0)
    if (updates.length === 0) return
    const d = db()
    await runCompiled(
      updates.map((r) =>
        d
          .updateTable('player')
          .set({ rankBadge: r.badge })
          .where('accountId', '=', r.account_id)
          .compile(),
      ),
    )
  } catch {
    // Ranks are cosmetic; the next sync or friend refresh retries.
  }
}

// ------------------------------------------------------------------ run

export async function runSync(opts: SyncOptions, onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
  const token = await getRefreshToken()
  if (!token) throw new SyncAbort('Connect your Steam account in Settings first.')
  const until = await backoffUntil()
  if (until) throw new SyncAbort(`Steam asked us to slow down. Steam requests resume at ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`)

  const gc = new DeadlockGc((t) => void saveRefreshToken(t))
  const result: SyncResult = {
    selfAccountId: 0,
    players: 0,
    newMatches: 0,
    newByAccount: {},
    stoppedBecause: null,
    errors: [],
  }
  try {
    onProgress({ step: 'Signing in to Steam' })
    await gc.connect(token)
    const self = gc.accountId
    result.selfAccountId = self
    onProgress({ step: 'Connecting to Deadlock' })
    await gc.openGameCoordinator()

    onProgress({ step: 'Loading friends' })
    const targets = opts.target ? [opts.target] : await everyoneToSync(gc, self)
    const flags = { stop: null as string | null }
    for (const [i, accountId] of targets.entries()) {
      onProgress({ step: 'Syncing match history', done: i, total: targets.length })
      try {
        const n = await syncAccount(gc, accountId, self, opts, flags)
        result.players++
        result.newMatches += n
        if (n > 0) result.newByAccount[accountId] = n
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await db()
          .insertInto('syncLog')
          .values({ accountId, trigger: 'app', status: 'error', newMatches: 0, error: message, createdAt: new Date().toISOString() })
          .execute()
        if (err instanceof GcError && (SESSION_OVER.includes(err.code) || err.code === 'rate_limited')) {
          flags.stop = err.code === 'rate_limited' ? 'Steam rate-limited history requests. Pausing Steam requests for 2 hours.' : message
          break
        }
        result.errors.push(message)
      }
      if (flags.stop) break
    }
    result.stoppedBecause = flags.stop

    await updatePlayerRanks(targets)
    return result
  } catch (err) {
    if (err instanceof GcError && err.code === 'login') throw new SyncAbort('Your Steam login expired. Reconnect Steam in Settings.')
    if (err instanceof GcError && err.code === 'rate_limited') {
      await startBackoff()
      throw new SyncAbort('Steam rate-limited requests. Pausing Steam requests for 2 hours.')
    }
    throw err
  } finally {
    gc.disconnect()
  }
}

/** One match's details right now (opening a match page without them). */
export async function syncOneMatch(matchId: number, cloud: DetailsSource | null): Promise<void> {
  if (cloud && (await cloud.pull([matchId]).catch(() => new Set<number>())).has(matchId)) return
  const token = await getRefreshToken()
  if (!token) throw new SyncAbort('Connect your Steam account in Settings first.')
  if (await backoffUntil()) throw new SyncAbort('Steam asked us to slow down; try again later.')
  if ((await budgetLeft('details')) === 0) throw new SyncAbort('Steam request cap reached; try again later.')
  const gc = new DeadlockGc((t) => void saveRefreshToken(t))
  try {
    await gc.connect(token)
    await gc.openGameCoordinator()
    await fetchAndStoreMatchDetail(gc, matchId)
  } catch (err) {
    if (err instanceof GcError && err.code === 'rate_limited') await startBackoff()
    throw err
  } finally {
    gc.disconnect()
  }
}
