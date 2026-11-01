import { MATCH_DETAIL_VERSION } from '@deadlock/core/domain/matches/validators/match-detail'
import {
  DETAILS_GET_MAX,
  PUSH_LIMITS,
  type CloudMatchDetail,
  type CloudPlayerMatch,
  type PullResult,
  type PushBody,
  type PushResult,
} from '@deadlock/core/sync/protocol'
import type { Kysely, Transaction } from 'kysely'
import type { CloudSyncResult } from '../../shared/api'
import { db } from '../db'
import type { DB } from '../db/schema'
import type { DetailsSource } from '../sync/engine'
import { getState, setState } from '../sync/state'
import { CloudError, cloudFetch, getCloudToken } from './client'

// Local ↔ cloud: push the outbox, pull the change feed, and fetch match
// details from the cloud before spending Steam requests on them.

const CURSOR_KEY = 'cloud.cursor'
const APPLYING_KEY = 'cloud.applying'
const MAX_PUSH_ROUNDS = 200
const MAX_PULL_PAGES = 400
const DETAILS_BYTES_PER_PUSH = 1_800_000

/** Run `fn` with outbox triggers paused, so rows from the cloud aren't pushed back. */
async function applyingRemote(fn: (trx: Transaction<DB>) => Promise<void>): Promise<void> {
  await db()
    .transaction()
    .execute(async (trx) => {
      await trx.insertInto('syncState').values({ key: APPLYING_KEY, value: '1' }).onConflict((oc) => oc.column('key').doNothing()).execute()
      try {
        await fn(trx)
      } finally {
        await trx.deleteFrom('syncState').where('key', '=', APPLYING_KEY).execute()
      }
    })
}

async function storeDetails(details: CloudMatchDetail[]): Promise<number[]> {
  const stored: number[] = []
  await applyingRemote(async (trx) => {
    for (const d of details) {
      const res = await trx
        .insertInto('matchDetail')
        .values({ matchId: d.matchId, data: d.data, fetchedAt: d.fetchedAt })
        .onConflict((oc) => oc.column('matchId').doUpdateSet({ data: d.data, fetchedAt: d.fetchedAt }))
        .executeTakeFirst()
      if (Number(res.numInsertedOrUpdatedRows ?? 0) > 0) stored.push(d.matchId)
      await trx.deleteFrom('matchDetailAttempt').where('matchId', '=', d.matchId).execute()
    }
  })
  return stored
}

async function fetchDetails(matchIds: number[]): Promise<number[]> {
  const stored: number[] = []
  for (let i = 0; i < matchIds.length; i += DETAILS_GET_MAX) {
    const { details } = await cloudFetch<{ details: CloudMatchDetail[] }>('/v1/details/get', { body: { matchIds: matchIds.slice(i, i + DETAILS_GET_MAX) } })
    stored.push(...(await storeDetails(details)))
  }
  return stored
}

/** Local match ids whose details are missing or older than the cloud's. */
async function wantedDetails(d: Kysely<DB>, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const have = new Map<number, number>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await d
      .selectFrom('matchDetail')
      .select(['matchId', (eb) => eb.fn<number>('json_extract', [eb.ref('data'), eb.val('$.v')]).as('v')])
      .where('matchId', 'in', ids.slice(i, i + 500))
      .execute()
    for (const r of rows) have.set(r.matchId, Number(r.v))
  }
  return ids.filter((id) => (have.get(id) ?? 0) < MATCH_DETAIL_VERSION)
}

// ------------------------------------------------------------------- pull

async function pull(): Promise<{ rows: number; details: number }> {
  let since = (await getState<number>(CURSOR_KEY)) ?? 0
  let rows = 0
  const detailIds = new Set<number>()
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const r = await cloudFetch<PullResult>(`/v1/pull?since=${since}`)
    if (r.players.length || r.playerMatches.length) {
      await applyingRemote(async (trx) => {
        const now = new Date().toISOString()
        for (const p of r.players) {
          await trx.insertInto('player').values({ accountId: p.accountId, createdAt: now }).onConflict((oc) => oc.column('accountId').doNothing()).execute()
          const profile = {
            ...(p.personaName ? { personaName: p.personaName } : {}),
            ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
            ...(p.profileUrl ? { profileUrl: p.profileUrl } : {}),
            ...(p.rankBadge != null ? { rankBadge: p.rankBadge } : {}),
          }
          if (Object.keys(profile).length > 0) await trx.updateTable('player').set(profile).where('accountId', '=', p.accountId).execute()
        }
        for (const m of r.playerMatches) {
          await trx.insertInto('player').values({ accountId: m.accountId, createdAt: now }).onConflict((oc) => oc.column('accountId').doNothing()).execute()
          await trx.insertInto('playerMatch').values(m).onConflict((oc) => oc.columns(['accountId', 'matchId']).doNothing()).execute()
        }
      })
      rows += r.players.length + r.playerMatches.length
    }
    for (const id of r.detailIds) detailIds.add(id)
    since = r.nextSeq
    await setState(CURSOR_KEY, since)
    if (r.done) break
  }
  const wanted = await wantedDetails(db(), [...detailIds])
  const stored = await fetchDetails(wanted)
  return { rows, details: stored.length }
}

// ------------------------------------------------------------------- push

function detailVersion(data: string): number {
  try {
    return (JSON.parse(data) as { v?: number }).v ?? 0
  } catch {
    return 0 // unreadable row; the cloud would reject it anyway
  }
}

async function pushRound(): Promise<{ sent: number; changed: number }> {
  const d = db()
  const queue = await d.selectFrom('outbox').selectAll().orderBy('queuedAt').limit(PUSH_LIMITS.playerMatches).execute()
  if (queue.length === 0) return { sent: 0, changed: 0 }

  const playerKeys = queue.filter((q) => q.tbl === 'player').slice(0, PUSH_LIMITS.players)
  const matchKeys = queue.filter((q) => q.tbl === 'player_match')
  const detailKeys = queue.filter((q) => q.tbl === 'match_detail').slice(0, PUSH_LIMITS.matchDetails)

  const body: PushBody = { players: [], playerMatches: [], matchDetails: [] }
  const sent: typeof queue = []

  if (playerKeys.length) {
    const rows = await d.selectFrom('player').select(['accountId', 'personaName', 'avatarUrl', 'profileUrl', 'rankBadge']).where('accountId', 'in', playerKeys.map((k) => k.k1)).execute()
    const at = new Map(playerKeys.map((k) => [k.k1, k.queuedAt]))
    body.players = rows.map((r) => ({ ...r, updatedAt: at.get(r.accountId)! }))
    sent.push(...playerKeys)
  }
  if (matchKeys.length) {
    const accounts = [...new Set(matchKeys.map((k) => k.k1))]
    const wanted = new Set(matchKeys.map((k) => `${k.k1}:${k.k2}`))
    const rows = await d.selectFrom('playerMatch').selectAll().where('accountId', 'in', accounts).where('matchId', 'in', [...new Set(matchKeys.map((k) => k.k2))]).execute()
    body.playerMatches = rows.filter((r) => wanted.has(`${r.accountId}:${r.matchId}`)).map((r): CloudPlayerMatch => ({ ...r, abandonedTimeS: r.abandonedTimeS ?? 0 }))
    sent.push(...matchKeys)
  }
  if (detailKeys.length) {
    const rows = await d.selectFrom('matchDetail').selectAll().where('matchId', 'in', detailKeys.map((k) => k.k1)).execute()
    const byId = new Map(rows.map((r) => [r.matchId, r]))
    let bytes = 0
    for (const k of detailKeys) {
      const r = byId.get(k.k1)
      if (r) {
        // ~36 KB each: keep a request under ~2 MB, but always send at least one.
        if (bytes + r.data.length > DETAILS_BYTES_PER_PUSH && body.matchDetails.length > 0) break
        bytes += r.data.length
        const v = detailVersion(r.data)
        if (v > 0) body.matchDetails.push({ matchId: r.matchId, v, data: r.data, fetchedAt: r.fetchedAt })
      }
      sent.push(k) // includes rows deleted since they were queued
    }
  }

  const result = await cloudFetch<PushResult>('/v1/push', { body })
  // Dequeue exactly what was sent (rows queued again meanwhile keep their newer entry).
  await d
    .transaction()
    .execute(async (trx) => {
      for (const k of sent) await trx.deleteFrom('outbox').where('tbl', '=', k.tbl).where('k1', '=', k.k1).where('k2', '=', k.k2).where('queuedAt', '=', k.queuedAt).execute()
    })
  return { sent: sent.length, changed: result.changed.players + result.changed.playerMatches + result.changed.matchDetails }
}

async function push(): Promise<number> {
  let changed = 0
  for (let i = 0; i < MAX_PUSH_ROUNDS; i++) {
    const r = await pushRound()
    changed += r.changed
    if (r.sent === 0) break
  }
  return changed
}

// ------------------------------------------------------------------- public

export async function pendingPush(): Promise<number> {
  const row = await db().selectFrom('outbox').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()
  return Number(row?.n ?? 0)
}

/** Pull then push. Null when not signed in to the cloud. */
export async function cloudSync(): Promise<CloudSyncResult | null> {
  if (!(await getCloudToken())) return null
  try {
    const pulled = await pull()
    const pushed = await push()
    await setState('cloud.lastSync', { at: new Date().toISOString(), error: null })
    return { pulled: pulled.rows, detailsPulled: pulled.details, pushed }
  } catch (err) {
    const message = err instanceof CloudError || err instanceof Error ? err.message : String(err)
    await setState('cloud.lastSync', { at: new Date().toISOString(), error: message })
    throw err
  }
}

/** Push only: share what this install downloaded, without pulling. */
export async function cloudPush(): Promise<CloudSyncResult | null> {
  if (!(await getCloudToken())) return null
  try {
    const pushed = await push()
    await setState('cloud.lastSync', { at: new Date().toISOString(), error: null })
    return { pulled: 0, detailsPulled: 0, pushed }
  } catch (err) {
    const message = err instanceof CloudError || err instanceof Error ? err.message : String(err)
    await setState('cloud.lastSync', { at: new Date().toISOString(), error: message })
    throw err
  }
}

/** Cloud-before-Valve: pull whichever of these match details the cloud already has. */
export function cloudDetailsSource(): DetailsSource {
  return {
    async pull(matchIds) {
      if (matchIds.length === 0 || !(await getCloudToken())) return new Set()
      const have: number[] = []
      for (let i = 0; i < matchIds.length; i += 1000) {
        const r = await cloudFetch<{ have: number[] }>('/v1/details/lookup', { body: { matchIds: matchIds.slice(i, i + 1000), minVersion: MATCH_DETAIL_VERSION } })
        have.push(...r.have)
      }
      return new Set(await fetchDetails(have))
    },
  }
}
