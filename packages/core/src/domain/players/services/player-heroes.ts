import type { ItemInfo } from '../../assets/types'
import type { MatchAnalysis } from '../../matches/services/analysis'
import { median } from '../../matches/services/match-facts'
import type { MatchDetailData, MatchDetailPlayer } from '../../matches/validators/match-detail'

// Per-hero record across a player's games. Pure. The match list gives the
// basics for every game; detailed games add lanes, farm vs the lobby,
// matchups and item timings.

/** One detailed game, as the hero summary needs it. */
export interface HeroGameFacts {
  matchId: number
  heroId: number
  won: boolean
  /** Your lane's soul difference at the end of laning (null without lanes). */
  laneDiff: number | null
  laneOpponents: number[]
  enemies: number[]
  /** Your end souls ÷ the lobby median. */
  soulsVsLobby: number
  impact: number
  /** Shop item → first buy time (s). */
  firstBuys: [number, number][]
}

export interface Matchup {
  heroId: number
  games: number
  wins: number
}

export interface LaneMatchup {
  heroId: number
  games: number
  /** Lanes you won / lost against them (±500 souls at the end of laning). */
  won: number
  lost: number
}

export interface ItemTiming {
  itemId: number
  /** Median first buy time in wins vs losses, and how many games each. */
  winS: number
  lossS: number
  wins: number
  losses: number
}

export interface HeroSummary {
  heroId: number
  games: number
  wins: number
  kda: number
  deaths: number
  soulsPerMin: number
  /** Games with full details. */
  detailed: number
  laneGames: number
  laneWon: number
  laneLost: number
  /** Average of your souls ÷ the lobby median (null without details). */
  soulsVsLobby: number | null
  impact: number | null
  /** Enemy heroes faced 2+ times, worst record first. */
  matchups: Matchup[]
  /** Enemies in your lane 2+ times. */
  laneMatchups: LaneMatchup[]
  /** Items you buy in wins and losses, biggest timing gap first. */
  itemTiming: ItemTiming[]
}

export const LANE_SWING = 500
const MIN_MATCHUP = 2
const MIN_TIMING_SIDE = 2
const MIN_TIMING_GAP_S = 90

export function heroGameFacts(detail: MatchDetailData, me: MatchDetailPlayer, analysis: MatchAnalysis, impact: number, items: Record<number, ItemInfo>): HeroGameFacts {
  const lane = me.lane != null ? analysis.lanes.find((l) => l.lane === me.lane) : undefined
  const firstBuys = new Map<number, number>()
  for (const it of me.items) {
    const info = items[it.itemId]
    if (!info || info.slot === 'other' || !(info.cost && info.cost > 0)) continue
    if (!firstBuys.has(it.itemId)) firstBuys.set(it.itemId, it.t)
  }
  return {
    matchId: detail.matchId,
    heroId: me.heroId,
    won: detail.winningTeam === me.team,
    laneDiff: lane ? lane.soulDiff : null,
    laneOpponents: lane ? lane.theirs.map((p) => p.heroId) : [],
    enemies: detail.players.filter((p) => p.team !== me.team).map((p) => p.heroId),
    soulsVsLobby: me.netWorth / Math.max(1, median(detail.players.map((p) => p.netWorth))),
    impact,
    firstBuys: [...firstBuys.entries()],
  }
}

interface ListGame {
  heroId: number
  won: boolean
  kills: number
  deaths: number
  assists: number
  netWorth: number
  durationS: number
}

export function heroSummaries(games: ListGame[], detailed: HeroGameFacts[]): HeroSummary[] {
  const byHero = new Map<number, ListGame[]>()
  for (const g of games) byHero.set(g.heroId, [...(byHero.get(g.heroId) ?? []), g])
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  return [...byHero.entries()]
    .map(([heroId, gs]): HeroSummary => {
      const ds = detailed.filter((d) => d.heroId === heroId)
      const laned = ds.filter((d) => d.laneDiff != null)

      const vs = new Map<number, Matchup>()
      const inLane = new Map<number, LaneMatchup>()
      for (const d of ds) {
        for (const e of d.enemies) {
          const m = vs.get(e) ?? { heroId: e, games: 0, wins: 0 }
          m.games++
          if (d.won) m.wins++
          vs.set(e, m)
        }
        for (const e of d.laneOpponents) {
          const m = inLane.get(e) ?? { heroId: e, games: 0, won: 0, lost: 0 }
          m.games++
          if (d.laneDiff! >= LANE_SWING) m.won++
          else if (d.laneDiff! <= -LANE_SWING) m.lost++
          inLane.set(e, m)
        }
      }

      // Same item, wins vs losses: when you get it, not whether it "wins".
      const times = new Map<number, { win: number[]; loss: number[] }>()
      for (const d of ds)
        for (const [itemId, t] of d.firstBuys) {
          const e = times.get(itemId) ?? { win: [], loss: [] }
          ;(d.won ? e.win : e.loss).push(t)
          times.set(itemId, e)
        }
      const itemTiming = [...times.entries()]
        .filter(([, e]) => e.win.length >= MIN_TIMING_SIDE && e.loss.length >= MIN_TIMING_SIDE)
        .map(([itemId, e]) => ({ itemId, winS: median(e.win), lossS: median(e.loss), wins: e.win.length, losses: e.loss.length }))
        .filter((t) => Math.abs(t.lossS - t.winS) >= MIN_TIMING_GAP_S)
        .sort((a, b) => b.lossS - b.winS - (a.lossS - a.winS))

      return {
        heroId,
        games: gs.length,
        wins: gs.filter((g) => g.won).length,
        kda: avg(gs.map((g) => (g.kills + g.assists) / Math.max(1, g.deaths))),
        deaths: avg(gs.map((g) => g.deaths)),
        soulsPerMin: avg(gs.map((g) => g.netWorth / Math.max(1, g.durationS / 60))),
        detailed: ds.length,
        laneGames: laned.length,
        laneWon: laned.filter((d) => d.laneDiff! >= LANE_SWING).length,
        laneLost: laned.filter((d) => d.laneDiff! <= -LANE_SWING).length,
        soulsVsLobby: ds.length ? avg(ds.map((d) => d.soulsVsLobby)) : null,
        impact: ds.length ? avg(ds.map((d) => d.impact)) : null,
        matchups: [...vs.values()].filter((m) => m.games >= MIN_MATCHUP).sort((a, b) => a.wins / a.games - b.wins / b.games || b.games - a.games),
        laneMatchups: [...inLane.values()].filter((m) => m.games >= MIN_MATCHUP).sort((a, b) => b.lost - b.won - (a.lost - a.won) || b.games - a.games),
        itemTiming,
      }
    })
    .sort((a, b) => b.games - a.games)
}
