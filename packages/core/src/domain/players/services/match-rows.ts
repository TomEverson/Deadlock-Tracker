
/**
 * One match-history entry, as returned both by Valve's Game Coordinator
 * (CMsgClientToGCGetMatchHistoryResponse.Match) and by deadlock-api, which
 * passes the same fields through.
 */
export interface HistoryEntry {
  match_id: number
  hero_id: number
  hero_level: number
  start_time: number
  game_mode: number
  match_mode: number
  player_team: number
  player_kills: number
  player_deaths: number
  player_assists: number
  denies: number
  net_worth: number
  last_hits: number
  abandoned_time_s?: number | null
  match_duration_s: number
  match_result: number
}

/** A `player_match` row as inserted (camelCase, matching the Kysely CamelCasePlugin). */
export interface PlayerMatchInsert {
  accountId: number
  matchId: number
  heroId: number
  startTime: number
  durationS: number
  gameMode: number
  matchMode: number
  team: number
  won: number
  kills: number
  deaths: number
  assists: number
  netWorth: number
  lastHits: number
  denies: number
  heroLevel: number
  abandonedTimeS: number
}

export function toPlayerMatchRow(accountId: number, e: HistoryEntry): PlayerMatchInsert {
  return {
    accountId,
    matchId: e.match_id,
    heroId: e.hero_id,
    startTime: e.start_time,
    durationS: e.match_duration_s,
    gameMode: e.game_mode,
    matchMode: e.match_mode,
    team: e.player_team,
    // match_result is the winning team (verified against deadlock-api's
    // hero-stats win counts).
    won: e.player_team === e.match_result ? 1 : 0,
    kills: e.player_kills,
    deaths: e.player_deaths,
    assists: e.player_assists,
    netWorth: e.net_worth,
    lastHits: e.last_hits,
    denies: e.denies,
    heroLevel: e.hero_level,
    abandonedTimeS: e.abandoned_time_s ?? 0,
  }
}
