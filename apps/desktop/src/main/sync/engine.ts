import type { CompiledQuery } from 'kysely'
import { MATCH_DETAIL_VERSION } from '@deadlock/core/domain/matches/validators/match-detail'
import { trimMetadata, type MatchMetadata, type PlayerProfile } from '@deadlock/core/domain/matches/services/trim-metadata'
import { toPlayerMatchRow, type HistoryEntry } from '@deadlock/core/domain/players/services/match-rows'
import { DeadlockGc, GcError, type GcErrorCode } from '@deadlock/core/steam/gc'
import { decodeMatchMetadata, downloadMatchMetadata } from '@deadlock/core/steam/match-metadata'
import { db } from '../db'
import { fetchCachedMatchMetadata, fetchCommunityMatchHistory, fetchSteamProfiles, fetchPlayerRanks } from '../services/deadlock-api'
import { getSelfAccountId } from '../services/player-repo'
import { getRefreshToken, getSteamAccount, saveRefreshToken, setSteamAccount } from '../steam/account'
import { backoffFor, budgetLeft, clearBackoff, deleteState, getState, recordRequest, setState, startBackoff } from './state'

// One sync run, writing to the app's local database:
//   1. Match lists, per account: Game Coordinator → community API
//      (deadlock-api) → the group's cloud (D1), each source only when the one
//      before it can't be used (no Steam, rate limit, request cap, error).
//   2. Match details for the newest synced matches still missing them:
//      cloud (D1) → community cache → Game Coordinator — cheapest first,
//      Steam's small detail quota last.
// Opening a match also downloads its details on demand (syncOneMatch).

// A run stops after this many history pages so one account with a deep
// history can't spend the whole day's budget in a single burst. An unfinished
// walk saves its cursor and continues on the next run.
const MAX_PAGES_PER_RUN = 8
// Details per Sync click, newest matches first; the rest follow on later syncs.
const DETAILS_PER_SYNC = 40
// A free-sources backfill (cloud + community cache only) can take a player's whole history.
const BACKFILL_LIMIT = 300
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
  /** Where each account's match list came from this run. */
  listSources: { gc: number; community: number }
  /** Accounts neither the GC nor the community API could supply: the caller pulls them from the cloud. */
  needsCloud: number[]
  /** Match details stored this run, by source. */
  details: { cloud: number; community: number; gc: number; missing: number }
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

  // A walk that stopped halfway (page cap, rate limit) resumes from its cursor
  // instead of re-reading the newest pages every run.
  const cursorKey = `gc.cursor.${accountId}`
  let cursor: string | null = opts.full ? null : ((await getState<string>(cursorKey)) ?? null)
  const resuming = cursor !== null

  const fetched: HistoryEntry[] = []
  let complete = true
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    if ((await budgetLeft('history')) === 0) {
      flags.stop = "Reached the app's request cap for Steam history. It continues as older requests age out."
      complete = false
      break
    }
    let result
    try {
      result = await gc.getMatchHistoryPage(accountId, cursor)
    } catch (err) {
      // A remembered cursor Steam no longer accepts: drop it and start clean next run.
      if (resuming) await deleteState(cursorKey)
      if (err instanceof GcError && err.code === 'rate_limited') {
        const until = await startBackoff('history')
        flags.stop = `Steam rate-limited history requests. Pausing them until ${formatClock(until)}.`
        if (fetched.length === 0) throw err
        complete = false
        break
      }
      throw err
    }
    // Only a page we actually received counts against the local budget.
    await recordRequest('history')
    await clearBackoff('history')
    fetched.push(...result.matches)
    if (watermark !== null && result.matches.some((m) => m.start_time <= watermark)) break
    if (!result.cursor) break
    cursor = result.cursor
    await setState(cursorKey, cursor)
    if (page === MAX_PAGES_PER_RUN - 1) complete = false
  }
  if (complete) await deleteState(cursorKey)

  const profile = await gc.getProfile(accountId)
  const fresh = fetched.filter((m) => !known.has(m.match_id))
  const newestFetched = fetched.reduce<number | null>((max, m) => (max === null || m.start_time > max ? m.start_time : max), null)
  const verifiedUntil = complete ? (newestFetched ?? watermark) : (existing?.historyVerifiedUntil ?? null)
  await storeHistory(accountId, self, fresh, { verifiedUntil, profile, trigger: opts.full ? 'app-full' : 'app' })
  if (accountId === self) await setSteamAccount({ accountId: self, name: profile.name })
  return fresh.length
}

/**
 * Match list from deadlock-api when the GC can't be used. It doesn't move
 * the history watermark: the community copy may lag the GC, so the next GC
 * sync still re-reads past it.
 */
async function syncAccountFromCommunity(accountId: number, self: number): Promise<number> {
  const entries = await fetchCommunityMatchHistory(accountId)
  const known = new Set((await db().selectFrom('playerMatch').select('matchId').where('accountId', '=', accountId).execute()).map((r) => r.matchId))
  const fresh = entries.filter((m) => !known.has(m.match_id))
  await storeHistory(accountId, self, fresh, { trigger: 'community' })
  return fresh.length
}

async function storeHistory(
  accountId: number,
  self: number,
  fresh: HistoryEntry[],
  meta: { verifiedUntil?: number | null; profile?: { name: string | null; avatar: string | null }; trigger: string },
): Promise<void> {
  const d = db()
  const now = new Date().toISOString()
  const { profile } = meta
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
        ...(meta.verifiedUntil !== undefined ? { historyVerifiedUntil: meta.verifiedUntil } : {}),
        ...(profile?.name ? { personaName: profile.name } : {}),
        ...(profile?.avatar ? { avatarUrl: profile.avatar } : {}),
        profileUrl: `https://steamcommunity.com/profiles/${(76561197960265728n + BigInt(accountId)).toString()}/`,
        ...(accountId === self ? { isSelf: 1 } : {}),
      })
      .where('accountId', '=', accountId)
      .compile(),
    d.insertInto('syncLog').values({ accountId, trigger: meta.trigger, status: 'ok', newMatches: fresh.length, error: null, createdAt: now }).compile(),
  ])
  if (accountId === self) await d.updateTable('player').set({ isSelf: 0 }).where('accountId', '!=', self).execute()
}

// ------------------------------------------------------------------ details

const deadlockApiProfiles = async (ids: number[]) => {
  const out = new Map<number, PlayerProfile>()
  const rows = await fetchSteamProfiles(ids).catch(() => [])
  for (const p of rows) if (p.personaname) out.set(p.account_id, { name: p.personaname, avatar: p.avatarmedium ?? null })
  return out
}

/**
 * Names for a match's players: Steam personas (when we have a GC session),
 * then the local player table, then deadlock-api. Matches served from the
 * community cache arrive without a Steam session, hence the optional client.
 */
async function resolveProfiles(gc: DeadlockGc | null, accountIds: number[]): Promise<Map<number, PlayerProfile>> {
  const out = new Map<number, PlayerProfile>()
  if (gc) for (const [id, p] of await gc.getProfiles(accountIds)) if (p.name) out.set(id, p)
  let missing = accountIds.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const rows = await db().selectFrom('player').select(['accountId', 'personaName', 'avatarUrl']).where('accountId', 'in', missing).execute()
    for (const r of rows) if (r.personaName) out.set(r.accountId, { name: r.personaName, avatar: r.avatarUrl })
    missing = missing.filter((id) => !out.has(id))
  }
  if (missing.length > 0) for (const [id, p] of await deadlockApiProfiles(missing)) out.set(id, p)
  return out
}

/** Turn Valve's metadata into the row match_detail stores. Shared by both sources. */
async function storeMatchDetail(meta: MatchMetadata, profiles: Map<number, PlayerProfile>): Promise<void> {
  const detail = trimMetadata(meta, profiles)
  const data = JSON.stringify(detail)
  const fetchedAt = new Date().toISOString()
  await db()
    .insertInto('matchDetail')
    .values({ matchId: detail.matchId, data, fetchedAt })
    .onConflict((oc) => oc.column('matchId').doUpdateSet({ data, fetchedAt }))
    .execute()
  await db().deleteFrom('matchDetailAttempt').where('matchId', '=', detail.matchId).execute()
}

/**
 * A match whose metadata deadlock-api already has. The file is the same one
 * Valve serves, so it is decoded by the same code — it just costs no Steam
 * request. Returns false when the match isn't cached (or the API is degraded),
 * which sends the caller down the Game Coordinator path.
 */
export async function fetchAndStoreCachedMatchDetail(matchId: number): Promise<boolean> {
  let raw: Buffer | null
  try {
    raw = await fetchCachedMatchMetadata(matchId)
  } catch (err) {
    console.warn(`[sync] community cache lookup failed for ${matchId}: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
  if (!raw) return false
  try {
    const meta = decodeMatchMetadata(raw, matchId)
    await storeMatchDetail(meta, await resolveProfiles(null, meta.players.map((p) => p.account_id)))
    return true
  } catch (err) {
    console.warn(`[sync] cached metadata for ${matchId} was unusable: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function fetchAndStoreMatchDetail(gc: DeadlockGc, matchId: number): Promise<void> {
  const salts = await gc.getMatchSalts(matchId)
  // Count it once Steam answered: a refused or timed-out request must not burn
  // the daily cap, or a rate-limited day wastes tomorrow's budget too.
  await recordRequest('details')
  await clearBackoff('details')
  const meta = await downloadMatchMetadata(salts)
  await storeMatchDetail(meta, await resolveProfiles(gc, meta.players.map((p) => p.account_id)))
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

/** Accounts to sync without a Steam session: you and everyone already in the local database, most recently viewed first. */
async function localTargets(self: number | null): Promise<number[]> {
  const rows = await db().selectFrom('player').select('accountId').where((eb) => eb.or([eb('isFriend', '=', 1), eb('isSelf', '=', 1)])).orderBy('lastViewedAt', 'desc').execute()
  const ids = rows.map((r) => r.accountId)
  return self ? [self, ...ids.filter((id) => id !== self)] : ids
}

export async function runSync(opts: SyncOptions, cloud: DetailsSource | null, onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
  const result: SyncResult = {
    selfAccountId: 0,
    players: 0,
    newMatches: 0,
    newByAccount: {},
    stoppedBecause: null,
    errors: [],
    listSources: { gc: 0, community: 0 },
    needsCloud: [],
    details: { cloud: 0, community: 0, gc: 0, missing: 0 },
  }

  // ---- Game Coordinator session, if Steam is connected. Failing to get one
  // isn't fatal: lists fall back to the community API, details to cloud/cache.
  let gc: DeadlockGc | null = null
  let gcProblem: string | null = null
  const token = await getRefreshToken()
  if (!token) gcProblem = 'Steam not connected'
  else {
    gc = new DeadlockGc((t) => void saveRefreshToken(t))
    try {
      onProgress({ step: 'Signing in to Steam' })
      await gc.connect(token)
      onProgress({ step: 'Connecting to Deadlock' })
      await gc.openGameCoordinator()
    } catch (err) {
      gc.disconnect()
      gc = null
      gcProblem =
        err instanceof GcError && err.code === 'login' ? 'Your Steam login expired. Reconnect Steam in Settings.' : err instanceof Error ? err.message : String(err)
      if (err instanceof GcError && err.code === 'rate_limited') await startBackoff('history')
    }
  }

  try {
    const self = gc?.accountId ?? (await getSteamAccount())?.accountId ?? (await getSelfAccountId()) ?? 0
    result.selfAccountId = self

    onProgress({ step: 'Loading friends' })
    const targets = opts.target ? [opts.target] : gc ? await everyoneToSync(gc, self) : await localTargets(self || null)

    // ---- 1. match lists: GC → community → (cloud, by the caller)
    const historyPause = await backoffFor('history')
    let gcForHistory = gc && !historyPause ? gc : null
    if (gc && historyPause) gcProblem = `Steam asked us to slow down. Match history requests resume at ${formatClock(historyPause)}.`
    const flags = { stop: null as string | null }
    for (const [i, accountId] of targets.entries()) {
      onProgress({ step: 'Syncing match history', done: i, total: targets.length })
      let n: number | null = null
      if (gcForHistory && !flags.stop) {
        try {
          n = await syncAccount(gcForHistory, accountId, self, opts, flags)
          result.listSources.gc++
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await db()
            .insertInto('syncLog')
            .values({ accountId, trigger: 'app', status: 'error', newMatches: 0, error: message, createdAt: new Date().toISOString() })
            .execute()
          if (err instanceof GcError && (SESSION_OVER.includes(err.code) || err.code === 'rate_limited')) {
            const until = err.code === 'rate_limited' ? await backoffFor('history') : null
            flags.stop = until ? `Steam rate-limited history requests. Pausing them until ${formatClock(until)}.` : message
            gcForHistory = null
          }
        }
      }
      if (n === null) {
        try {
          n = await syncAccountFromCommunity(accountId, self)
          result.listSources.community++
        } catch (err) {
          result.needsCloud.push(accountId)
          result.errors.push(`${accountId}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (n !== null) {
        result.players++
        result.newMatches += n
        if (n > 0) result.newByAccount[accountId] = n
      }
    }
    result.stoppedBecause = flags.stop ?? (gcProblem && result.listSources.community > 0 ? `${gcProblem} Used the community API instead.` : null)

    await updatePlayerRanks(targets)

    // ---- 2. match details: cloud → community cache → GC
    await syncDetails(targets, gc, cloud, onProgress, result, DETAILS_PER_SYNC)
    return result
  } finally {
    gc?.disconnect()
  }
}

/** Details for the newest synced matches that don't have current ones yet. */
async function syncDetails(
  accountIds: number[],
  gc: DeadlockGc | null,
  cloud: DetailsSource | null,
  onProgress: (p: SyncProgress) => void,
  result: SyncResult,
  limit: number,
): Promise<void> {
  if (accountIds.length === 0) return
  const rows = await db()
    .selectFrom('playerMatch')
    .leftJoin('matchDetail', 'matchDetail.matchId', 'playerMatch.matchId')
    .select(['playerMatch.matchId', (eb) => eb.fn<number | null>('json_extract', [eb.ref('matchDetail.data'), eb.val('$.v')]).as('v')])
    .where('playerMatch.accountId', 'in', accountIds)
    .groupBy('playerMatch.matchId')
    .orderBy('playerMatch.startTime', 'desc')
    .execute()
  let todo = rows.filter((r) => Number(r.v ?? 0) < MATCH_DETAIL_VERSION).map((r) => r.matchId).slice(0, limit)
  if (todo.length === 0) return

  // Cloud (D1): one lookup for the lot.
  onProgress({ step: 'Match details from the cloud' })
  if (cloud) {
    const got = await cloud.pull(todo).catch(() => new Set<number>())
    const current = new Set<number>()
    for (const id of got) if (await hasCurrentDetail(id)) current.add(id)
    result.details.cloud += current.size
    todo = todo.filter((id) => !current.has(id))
  }

  // Community cache: no Steam request.
  const left: number[] = []
  for (const [i, id] of todo.entries()) {
    onProgress({ step: 'Match details from the community cache', done: i, total: todo.length })
    if ((await fetchAndStoreCachedMatchDetail(id)) && (await hasCurrentDetail(id))) result.details.community++
    else left.push(id)
  }

  // Game Coordinator: Steam's detail quota, last.
  const pause = await backoffFor('details')
  const notCached = (n: number) => `${n} ${n === 1 ? "match isn't" : "matches aren't"} in the community cache`
  for (const [i, id] of left.entries()) {
    if (!gc || pause) {
      result.details.missing += left.length - i
      result.stoppedBecause ??= pause
        ? `${notCached(left.length - i)} — Steam is pausing detail requests, so they download from Steam after ${formatClock(pause)}.`
        : `${notCached(left.length - i)} yet — Sync downloads them from Steam.`
      break
    }
    if ((await budgetLeft('details')) === 0) {
      result.details.missing += left.length - i
      result.stoppedBecause ??= "Reached the app's request cap for Steam match details. The rest download on a later sync."
      break
    }
    onProgress({ step: 'Match details from Steam', done: i, total: left.length })
    try {
      await fetchAndStoreMatchDetail(gc, id)
      result.details.gc++
    } catch (err) {
      if (err instanceof GcError && err.code === 'rate_limited') {
        const until = await startBackoff('details')
        result.details.missing += left.length - i
        result.stoppedBecause ??= `${notCached(left.length - i)} — Steam asked us to slow down, so they download from Steam after ${formatClock(until)}.`
        break
      }
      result.details.missing++
    }
  }
}

/**
 * Fill in details for all of a player's previous games from the free
 * sources only (cloud, then community cache) — no Steam request, so it's
 * safe to run unprompted (opening a player's analysis). Matches neither
 * source has are left for Sync, which can spend Steam's detail quota.
 */
export async function backfillDetails(accountId: number, cloud: DetailsSource | null, onProgress: (p: SyncProgress) => void): Promise<SyncResult['details'] & { note: string | null }> {
  const result: SyncResult = {
    selfAccountId: 0,
    players: 0,
    newMatches: 0,
    newByAccount: {},
    stoppedBecause: null,
    errors: [],
    listSources: { gc: 0, community: 0 },
    needsCloud: [],
    details: { cloud: 0, community: 0, gc: 0, missing: 0 },
  }
  await syncDetails([accountId], null, cloud, onProgress, result, BACKFILL_LIMIT)
  return { ...result.details, note: result.stoppedBecause }
}

const detailRequests = new Map<number, Promise<void>>()
let detailQueue: Promise<unknown> = Promise.resolve()
let lastDetailRequestAt = 0
const DETAIL_REQUEST_GAP_MS = 1_500

/** Let a full sync wait for on-demand detail downloads instead of overlapping sessions. */
export async function waitForDetailRequests(): Promise<void> {
  await detailQueue.catch(() => {})
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

async function hasCurrentDetail(matchId: number): Promise<boolean> {
  const row = await db()
    .selectFrom('matchDetail')
    .select((eb) => eb.fn<number>('json_extract', [eb.ref('data'), eb.val('$.v')]).as('v'))
    .where('matchId', '=', matchId)
    .executeTakeFirst()
  return Number(row?.v ?? 0) >= MATCH_DETAIL_VERSION
}

/**
 * Bring a match saved by an older app version up to MATCH_DETAIL_VERSION
 * using only free sources — the group's cloud, then the community cache.
 * Never spends a Steam request (that stays behind the explicit Download
 * button). Returns whether the stored copy is now current.
 */
export async function upgradeMatchDetailFree(matchId: number, cloud: DetailsSource | null): Promise<boolean> {
  if (await hasCurrentDetail(matchId)) return true
  if (cloud && (await cloud.pull([matchId]).catch(() => new Set<number>())).has(matchId) && (await hasCurrentDetail(matchId))) return true
  return (await fetchAndStoreCachedMatchDetail(matchId)) && (await hasCurrentDetail(matchId))
}

/**
 * One match's details right now (opening a match page without them).
 *
 * Requests are serialized and de-duplicated: clicking two matches quickly
 * must not open two Steam sessions, and clicking the same match twice must
 * not spend two GC requests. Steam's per-account detail quota is small.
 */
export function syncOneMatch(matchId: number, cloud: DetailsSource | null): Promise<void> {
  const pending = detailRequests.get(matchId)
  if (pending) return pending

  const run = detailQueue.then(() => syncOneMatchInner(matchId, cloud))
  detailQueue = run.catch(() => {})
  const tracked = run.finally(() => detailRequests.delete(matchId))
  detailRequests.set(matchId, tracked)
  return tracked
}

async function syncOneMatchInner(matchId: number, cloud: DetailsSource | null): Promise<void> {
  // A match that is already current locally needs no network request at all.
  if (await hasCurrentDetail(matchId)) return

  // Cloud first: another install may already have paid the Steam request.
  if (cloud && (await cloud.pull([matchId]).catch(() => new Set<number>())).has(matchId)) return

  // Then the community cache: the same file Valve serves, for no Steam request.
  // It also works while Steam is rate-limiting us, or not connected at all.
  if (await fetchAndStoreCachedMatchDetail(matchId)) return

  const token = await getRefreshToken()
  if (!token) throw new SyncAbort('Connect your Steam account in Settings first.')

  const until = await backoffFor('details')
  if (until) throw new SyncAbort(`Steam rate limit hit. Match details resume after ${formatClock(until)}.`)

  if ((await budgetLeft('details')) === 0) throw new SyncAbort('Steam request cap reached; try again later.')

  // gc.pace() only covers requests inside one session; separate sessions need
  // their own gap so a burst of clicks can't hammer the GC.
  const wait = lastDetailRequestAt + DETAIL_REQUEST_GAP_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastDetailRequestAt = Date.now()

  const gc = new DeadlockGc((t) => void saveRefreshToken(t))
  try {
    await gc.connect(token)
    await gc.openGameCoordinator()
    await fetchAndStoreMatchDetail(gc, matchId)
  } catch (err) {
    if (err instanceof GcError && err.code === 'rate_limited') {
      const resume = await startBackoff('details')
      throw new SyncAbort(`Steam rate limit hit for match details. Try again after ${formatClock(resume)}.`)
    }
    throw err
  } finally {
    gc.disconnect()
  }
}
