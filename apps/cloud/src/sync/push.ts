import { matchDetailSchema } from '@deadlock/core/domain/matches/validators/match-detail'
import type { PushBody, PushResult } from '@deadlock/core/sync/protocol'
import type { Env } from '../env'

// Upserts plus a change_log row per real change. D1 runs a batch's
// statements in order on one connection, so `changes()` in the follow-up
// statement refers to the upsert right before it.

const BATCH = 100 // statements per D1 batch (each row = upsert + change_log)

const logIfChanged = (env: Env, tbl: string, k1: number, k2: number | null) =>
  env.DB.prepare('INSERT INTO change_log (tbl, k1, k2) SELECT ?, ?, ? WHERE changes() > 0').bind(tbl, k1, k2)

async function runPairs(env: Env, pairs: [D1PreparedStatement, D1PreparedStatement][]): Promise<number> {
  let changed = 0
  for (let i = 0; i < pairs.length; i += BATCH / 2) {
    const results = await env.DB.batch(pairs.slice(i, i + BATCH / 2).flat())
    for (let j = 1; j < results.length; j += 2) changed += results[j]?.meta.changes ?? 0
  }
  return changed
}

export async function handlePush(env: Env, body: PushBody, by: number): Promise<PushResult> {
  const now = new Date().toISOString()

  const players = body.players.map(
    (p) =>
      [
        env.DB.prepare(
          `INSERT INTO player (account_id, persona_name, avatar_url, profile_url, rank_badge, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
             persona_name = COALESCE(excluded.persona_name, player.persona_name),
             avatar_url = COALESCE(excluded.avatar_url, player.avatar_url),
             profile_url = COALESCE(excluded.profile_url, player.profile_url),
             rank_badge = COALESCE(excluded.rank_badge, player.rank_badge),
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > player.updated_at`,
        ).bind(p.accountId, p.personaName, p.avatarUrl, p.profileUrl, p.rankBadge, p.updatedAt),
        logIfChanged(env, 'player', p.accountId, null),
      ] as [D1PreparedStatement, D1PreparedStatement],
  )

  const matches = body.playerMatches.map(
    (m) =>
      [
        env.DB.prepare(
          `INSERT OR IGNORE INTO player_match (account_id, match_id, hero_id, start_time, duration_s, game_mode, match_mode, team, won, kills, deaths, assists, net_worth, last_hits, denies, hero_level, abandoned_time_s, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(m.accountId, m.matchId, m.heroId, m.startTime, m.durationS, m.gameMode, m.matchMode, m.team, m.won, m.kills, m.deaths, m.assists, m.netWorth, m.lastHits, m.denies, m.heroLevel, m.abandonedTimeS, by),
        logIfChanged(env, 'player_match', m.accountId, m.matchId),
      ] as [D1PreparedStatement, D1PreparedStatement],
  )

  // Only well-formed details are shared: parse against the current schema.
  const details = body.matchDetails.flatMap((d) => {
    let json: unknown
    try {
      json = JSON.parse(d.data)
    } catch {
      return []
    }
    const parsed = matchDetailSchema.safeParse(json)
    if (!parsed.success || parsed.data.matchId !== d.matchId || parsed.data.v !== d.v) return []
    return [
      [
        env.DB.prepare(
          `INSERT INTO match_detail (match_id, v, data, fetched_at, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET v = excluded.v, data = excluded.data, fetched_at = excluded.fetched_at, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at
           WHERE excluded.v > match_detail.v`,
        ).bind(d.matchId, d.v, d.data, d.fetchedAt, by, now),
        logIfChanged(env, 'match_detail', d.matchId, null),
      ] as [D1PreparedStatement, D1PreparedStatement],
    ]
  })

  return {
    changed: {
      players: await runPairs(env, players),
      playerMatches: await runPairs(env, matches),
      matchDetails: await runPairs(env, details),
    },
  }
}
