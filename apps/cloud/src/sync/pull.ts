import { PULL_PAGE, type CloudMatchDetail, type CloudPlayer, type CloudPlayerMatch, type PullResult } from '@deadlock/core/sync/protocol'
import type { Env } from '../env'

const IN_CHUNK = 90 // D1 allows 100 bound parameters per statement

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

interface PlayerRow {
  account_id: number
  persona_name: string | null
  avatar_url: string | null
  profile_url: string | null
  rank_badge: number | null
  updated_at: string
}
type MatchRow = Record<'account_id' | 'match_id' | 'hero_id' | 'start_time' | 'duration_s' | 'game_mode' | 'match_mode' | 'team' | 'won' | 'kills' | 'deaths' | 'assists' | 'net_worth' | 'last_hits' | 'denies' | 'hero_level' | 'abandoned_time_s', number>

const toPlayer = (r: PlayerRow): CloudPlayer => ({
  accountId: r.account_id,
  personaName: r.persona_name,
  avatarUrl: r.avatar_url,
  profileUrl: r.profile_url,
  rankBadge: r.rank_badge,
  updatedAt: r.updated_at,
})
const toMatch = (r: MatchRow): CloudPlayerMatch => ({
  accountId: r.account_id,
  matchId: r.match_id,
  heroId: r.hero_id,
  startTime: r.start_time,
  durationS: r.duration_s,
  gameMode: r.game_mode,
  matchMode: r.match_mode,
  team: r.team,
  won: r.won,
  kills: r.kills,
  deaths: r.deaths,
  assists: r.assists,
  netWorth: r.net_worth,
  lastHits: r.last_hits,
  denies: r.denies,
  heroLevel: r.hero_level,
  abandonedTimeS: r.abandoned_time_s,
})

/** Everything that changed after `since`, one page at a time. */
export async function handlePull(env: Env, since: number): Promise<PullResult> {
  const { results: changes } = await env.DB.prepare('SELECT seq, tbl, k1, k2 FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(since, PULL_PAGE)
    .all<{ seq: number; tbl: string; k1: number; k2: number | null }>()

  const playerIds = [...new Set(changes.filter((c) => c.tbl === 'player').map((c) => c.k1))]
  const matchKeys = [...new Map(changes.filter((c) => c.tbl === 'player_match').map((c) => [`${c.k1}:${c.k2}`, [c.k1, c.k2 ?? 0] as const])).values()]
  const detailIds = [...new Set(changes.filter((c) => c.tbl === 'match_detail').map((c) => c.k1))]

  const players: CloudPlayer[] = []
  for (const ids of chunks(playerIds, IN_CHUNK)) {
    const { results } = await env.DB.prepare(`SELECT * FROM player WHERE account_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<PlayerRow>()
    players.push(...results.map(toPlayer))
  }
  const playerMatches: CloudPlayerMatch[] = []
  for (const keys of chunks(matchKeys, IN_CHUNK / 2)) {
    const { results } = await env.DB.prepare(`SELECT * FROM player_match WHERE (account_id, match_id) IN (VALUES ${keys.map(() => '(?, ?)').join(',')})`)
      .bind(...keys.flat())
      .all<MatchRow>()
    playerMatches.push(...results.map(toMatch))
  }

  const last = changes.at(-1)?.seq ?? since
  return { players, playerMatches, detailIds, nextSeq: last, done: changes.length < PULL_PAGE }
}

export async function lookupDetails(env: Env, matchIds: number[], minVersion: number): Promise<number[]> {
  const have: number[] = []
  for (const ids of chunks(matchIds, IN_CHUNK)) {
    const { results } = await env.DB.prepare(`SELECT match_id FROM match_detail WHERE v >= ? AND match_id IN (${ids.map(() => '?').join(',')})`)
      .bind(minVersion, ...ids)
      .all<{ match_id: number }>()
    have.push(...results.map((r) => r.match_id))
  }
  return have
}

export async function getDetails(env: Env, matchIds: number[]): Promise<CloudMatchDetail[]> {
  if (matchIds.length === 0) return []
  const { results } = await env.DB.prepare(`SELECT match_id, v, data, fetched_at FROM match_detail WHERE match_id IN (${matchIds.map(() => '?').join(',')})`)
    .bind(...matchIds)
    .all<{ match_id: number; v: number; data: string; fetched_at: string }>()
  return results.map((r) => ({ matchId: r.match_id, v: r.v, data: r.data, fetchedAt: r.fetched_at }))
}
