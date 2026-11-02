import type { HeroInfo, ItemInfo } from '../../assets/types'
import { analyzeMatch, hasAnalysisData, type Finding } from '../../matches/services/analysis'
import { hasObjectiveData, objectivesReport } from '../../matches/services/objectives'
import type { MatchDetailData } from '../../matches/validators/match-detail'
import { coachReview } from '../../matches/services/coach'
import { deathPoints, deathsSummary, fightFacts, lobbyDeaths, type DeathPoint, type DeathsSummary, type FightFacts, type LobbyDeaths } from './player-deaths'
import { heroGameFacts, heroSummaries, LANE_SWING, type HeroGameFacts, type HeroSummary } from './player-heroes'

// A player's analysis across their stored matches. Pure. Two inputs:
// - games: the match list (every match: result, K/D/A, souls, length)
// - details: the full match details we happen to have (opened or synced)
// Habits and win conditions run analyzeMatch on each detailed game and add
// up the results; trends use the match list so they cover every game.

export interface HistoryGame {
  matchId: number
  startTime: number
  durationS: number
  won: boolean
  kills: number
  deaths: number
  assists: number
  netWorth: number
  heroId: number
}

export interface Habit {
  key: string
  label: string
  tone: 'bad' | 'good'
  /** Analyzed games it showed up in, out of `of`. */
  games: number
  of: number
  /** Rate in the newer vs older half of the analyzed games (null with too few games). */
  recentRate: number | null
  olderRate: number | null
  /** For a problem, "better" = happening less often lately. */
  trend: 'better' | 'worse' | 'same' | null
  /** The most recent finding's wording, as an example. */
  example: string
  /** Most recent first. */
  matchIds: number[]
}

export interface WinCondition {
  key: string
  label: string
  group: 'laning' | 'macro' | 'farm' | 'you'
  withGames: number
  withWins: number
  withoutGames: number
  withoutWins: number
  /** Win rate with minus without, -1..1. */
  delta: number
}

export interface TrendPoint {
  matchId: number
  startTime: number
  heroId: number
  won: boolean
  soulsPerMin: number
  kda: number
  deaths: number
  /** 0–100 impact score in that lobby (only for games with details). */
  impact: number | null
}

export interface PeriodStat {
  label: string
  recent: number
  previous: number
  /** Which direction is good. */
  better: 'higher' | 'lower'
  format: 'pct' | 'int' | 'dec'
}

export interface SessionStat {
  label: string
  games: number
  wins: number
}

export interface OverallAnalysis {
  totalGames: number
  /** Games with full details (habits and win conditions use only these). */
  analyzedGames: number
  wins: number
  habits: Habit[]
  strengths: Habit[]
  winConditions: WinCondition[]
  /** Oldest → newest, up to TREND_GAMES. */
  trend: TrendPoint[]
  recentWindow: number
  compare: PeriodStat[]
  sessions: SessionStat[]
  /** Every hero you played, most played first. */
  heroes: HeroSummary[]
  deaths: DeathsSummary
}

/** What the app sends the page: the analysis plus the heroes and items it mentions. */
export interface PlayerAnalysisResult extends OverallAnalysis {
  heroInfo: Record<number, HeroInfo>
  items: Record<number, ItemInfo>
}

/** Hero and item ids the analysis mentions (for icons). */
export function referencedIds(a: OverallAnalysis): { heroes: number[]; items: number[] } {
  const heroes = new Set<number>()
  const items = new Set<number>()
  for (const h of a.heroes) {
    heroes.add(h.heroId)
    for (const m of h.matchups) heroes.add(m.heroId)
    for (const m of h.laneMatchups) heroes.add(m.heroId)
    for (const t of h.itemTiming) items.add(t.itemId)
  }
  for (const k of a.deaths.killers) heroes.add(k.heroId)
  for (const t of a.trend) heroes.add(t.heroId)
  return { heroes: [...heroes], items: [...items] }
}

const TREND_GAMES = 50
const RECENT = 10
const PREVIOUS = 20
const SESSION_GAP_S = 45 * 60
const MIN_SIDE = 3

// Recurring findings, grouped by what they're about (titles carry numbers).
const PROBLEMS: { key: string; label: string; match: RegExp }[] = [
  { key: 'missed-fights', label: 'Missing team fights', match: /^(Missed \d+ of \d+ team fights|No kill or death in)/ },
  { key: 'died-first', label: 'Dying first in lost fights', match: /^Died first in/ },
  { key: 'picked-off', label: 'Getting picked off alone', match: /^Picked off alone/ },
  { key: 'early-deaths', label: 'Dying early in lane', match: /^Died \d+ times before/ },
  { key: 'time-dead', label: 'Too much time dead', match: /^Spent .* dead/ },
  { key: 'nemesis', label: 'Feeding one enemy hero', match: /^Killed by .+ \d+ times/ },
  { key: 'costly-deaths', label: 'Deaths that cost objectives', match: /led straight to a lost objective/ },
  { key: 'lane-behind', label: 'Losing your lane', match: /^Behind in .+ by/ },
  { key: 'last-hits', label: 'Poor last-hitting', match: /^Poor last-hitting/ },
  { key: 'left-lane', label: 'Leaving lane during laning', match: /^Left your lane too often/ },
  { key: 'out-pushed', label: 'Getting out-pushed in lane', match: /while you were in lane/ },
  { key: 'undefended', label: 'Not defending your lane', match: /fell undefended/ },
  { key: 'low-damage', label: 'Low hero damage', match: /^(Low hero damage|Plenty of souls, little damage)/ },
  { key: 'low-farm', label: 'Low farm', match: /^(Lowest souls on the team|Barely farmed jungle camps)/ },
  { key: 'unspent', label: 'Sitting on unspent souls', match: /^Sat on unspent souls/ },
  { key: 'slow-items', label: 'Slow item timings', match: /^(Slow first big item|No \d+\+ soul item)/ },
  { key: 'glass', label: 'Glass builds (no vitality)', match: /^Glass build/ },
  { key: 'anti-heal', label: 'Anti-heal missing or late', match: /^(No anti-heal|Late anti-heal)/ },
  { key: 'resist', label: "Not building resist vs the enemy's damage", match: /^No (spirit|bullet) resist/ },
  { key: 'objective-damage', label: 'Low objective damage', match: /^Least objective damage/ },
]

const STRENGTHS: { key: string; label: string; match: RegExp }[] = [
  { key: 'mvp', label: 'Match MVP or key player', match: /^(Match MVP|Key player)/ },
  { key: 'all-fights', label: 'In every team fight', match: /^Involved in every team fight/ },
  { key: 'lane-ahead', label: 'Winning your lane', match: /^Ahead in .+ by/ },
  { key: 'top-souls', label: 'Top farm in the lobby', match: /souls in the lobby$/ },
  { key: 'top-damage', label: 'Top damage in the lobby', match: /hero damage in the lobby$/ },
  { key: 'few-deaths', label: 'Rarely dying', match: /^Only \d+ deaths?$/ },
  { key: 'frontline', label: 'Frontlining', match: /^Frontliner$/ },
  { key: 'fast-items', label: 'Fast item timings', match: /^Fast first big item/ },
  { key: 'anti-heal-on-time', label: 'Anti-heal on time', match: /^Anti-heal on time/ },
  { key: 'rotations', label: 'Rotations that get kills', match: /^Rotated for \d+ kills/ },
]

interface GameFacts {
  matchId: number
  startTime: number
  won: boolean
  findings: Finding[]
  impact: number
  grade: string
  deaths: number
  conditions: Record<string, boolean | undefined>
  hero: HeroGameFacts
  deathPoints: DeathPoint[]
  fights: FightFacts | null
  lobbyDeaths: LobbyDeaths | null
}

function factsFor(detail: MatchDetailData, accountId: number, heroName: (id: number) => string, items: Record<number, ItemInfo>): GameFacts | null {
  const me = detail.players.find((p) => p.accountId === accountId)
  if (!me || !hasAnalysisData(detail)) return null
  const team = me.team
  const a = analyzeMatch(detail, team, heroName, items)
  const report = a.players.find((r) => r.accountId === accountId)
  if (!report) return null

  const lane = me.lane != null ? a.lanes.find((l) => l.lane === me.lane) : undefined
  const leadAt = (t: number) => {
    const pts = detail.netWorthTimeline
    if (pts.length === 0) return undefined
    const pt = pts.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best))
    return team === 0 ? pt.team0 - pt.team1 : pt.team1 - pt.team0
  }
  const firstBuilding = detail.objectives.find((o) => o.id !== 0)
  const firstBoss = detail.midBoss[0]
  const obj = hasObjectiveData(detail) ? objectivesReport(detail, team) : null
  const lead10 = detail.durationS > 660 ? leadAt(600) : undefined
  const review = coachReview(detail, a, heroName, { accountId, isSelf: true })

  return {
    matchId: detail.matchId,
    startTime: detail.startTime,
    won: detail.winningTeam === team,
    findings: report.findings,
    impact: report.score,
    grade: report.grade,
    deaths: me.deaths,
    conditions: {
      'lane-won': lane ? (lane.soulDiff >= LANE_SWING ? true : lane.soulDiff <= -LANE_SWING ? false : undefined) : undefined,
      'lead-10': lead10 == null || lead10 === 0 ? undefined : lead10 > 0,
      'first-building': firstBuilding ? firstBuilding.team !== team : undefined,
      'first-midboss': firstBoss ? firstBoss.teamClaimed === team : undefined,
      'more-camps': obj && obj.ours.camps !== obj.theirs.camps ? obj.ours.camps > obj.theirs.camps : undefined,
      'more-buffs': obj && obj.ours.permanentBuffs !== obj.theirs.permanentBuffs ? obj.ours.permanentBuffs > obj.theirs.permanentBuffs : undefined,
      'high-impact': report.grade === 'S' || report.grade === 'A',
    },
    hero: heroGameFacts(detail, me, a, report.score, items),
    deathPoints: deathPoints(detail, me),
    fights: fightFacts(review, me),
    lobbyDeaths: lobbyDeaths(detail),
  }
}

function habits(facts: GameFacts[], rules: typeof PROBLEMS, tone: 'bad' | 'good'): Habit[] {
  // facts are newest first; halves for the trend
  const half = Math.floor(facts.length / 2)
  const recent = facts.slice(0, half)
  const older = facts.slice(half)
  const hit = (g: GameFacts, rule: (typeof PROBLEMS)[number]) => g.findings.find((f) => f.tone === tone && rule.match.test(f.title))
  return rules
    .map((rule): Habit => {
      const games = facts.filter((g) => hit(g, rule))
      const rate = (gs: GameFacts[]) => (gs.length >= MIN_SIDE ? gs.filter((g) => hit(g, rule)).length / gs.length : null)
      const recentRate = rate(recent)
      const olderRate = rate(older)
      let trend: Habit['trend'] = null
      if (recentRate != null && olderRate != null) {
        const diff = recentRate - olderRate
        const lessOften = diff <= -0.15
        const moreOften = diff >= 0.15
        trend = !lessOften && !moreOften ? 'same' : tone === 'bad' ? (lessOften ? 'better' : 'worse') : moreOften ? 'better' : 'worse'
      }
      return {
        key: rule.key,
        label: rule.label,
        tone,
        games: games.length,
        of: facts.length,
        recentRate,
        olderRate,
        trend,
        example: games[0] ? hit(games[0], rule)!.title : '',
        matchIds: games.map((g) => g.matchId).slice(0, 6),
      }
    })
    .filter((h) => h.games >= 2 && h.games / h.of >= 0.2)
    .sort((a, b) => b.games - a.games)
}

function winConditions(facts: GameFacts[]): WinCondition[] {
  const medianDeaths = (() => {
    const s = facts.map((g) => g.deaths).sort((a, b) => a - b)
    return s.length ? s[s.length >> 1]! : 0
  })()
  const defs: { key: string; label: string; group: WinCondition['group']; get: (g: GameFacts) => boolean | undefined }[] = [
    { key: 'lane-won', label: 'You won your lane', group: 'laning', get: (g) => g.conditions['lane-won'] },
    { key: 'lead-10', label: 'Your team led at 10:00', group: 'laning', get: (g) => g.conditions['lead-10'] },
    { key: 'first-building', label: 'Your team took the first building', group: 'macro', get: (g) => g.conditions['first-building'] },
    { key: 'first-midboss', label: 'Your team claimed the first Mid-Boss', group: 'macro', get: (g) => g.conditions['first-midboss'] },
    { key: 'more-camps', label: 'Your team out-farmed the enemy jungle', group: 'farm', get: (g) => g.conditions['more-camps'] },
    { key: 'more-buffs', label: 'Your team collected more permanent buffs', group: 'farm', get: (g) => g.conditions['more-buffs'] },
    { key: 'few-deaths', label: `You died ${medianDeaths} times or fewer`, group: 'you', get: (g) => g.deaths <= medianDeaths },
    { key: 'high-impact', label: 'Your impact grade was A or S', group: 'you', get: (g) => g.conditions['high-impact'] },
  ]
  return defs
    .map((d): WinCondition => {
      const withG = facts.filter((g) => d.get(g) === true)
      const without = facts.filter((g) => d.get(g) === false)
      const wr = (gs: GameFacts[]) => (gs.length ? gs.filter((g) => g.won).length / gs.length : 0)
      return {
        key: d.key,
        label: d.label,
        group: d.group,
        withGames: withG.length,
        withWins: withG.filter((g) => g.won).length,
        withoutGames: without.length,
        withoutWins: without.filter((g) => g.won).length,
        delta: wr(withG) - wr(without),
      }
    })
    .filter((c) => c.withGames >= MIN_SIDE && c.withoutGames >= MIN_SIDE)
    .sort((a, b) => b.delta - a.delta)
}

function sessions(games: HistoryGame[]): SessionStat[] {
  const asc = [...games].sort((a, b) => a.startTime - b.startTime)
  const buckets: SessionStat[] = [
    { label: '1st game', games: 0, wins: 0 },
    { label: '2nd game', games: 0, wins: 0 },
    { label: '3rd game', games: 0, wins: 0 },
    { label: '4th game or later', games: 0, wins: 0 },
  ]
  let index = 0
  let prevEnd = -Infinity
  for (const g of asc) {
    index = g.startTime - prevEnd > SESSION_GAP_S ? 0 : index + 1
    prevEnd = g.startTime + g.durationS
    const b = buckets[Math.min(index, 3)]!
    b.games++
    if (g.won) b.wins++
  }
  return buckets
}

export function overallAnalysis(input: {
  accountId: number
  /** Newest first. */
  games: HistoryGame[]
  details: MatchDetailData[]
  heroName: (id: number) => string
  items: Record<number, ItemInfo>
}): OverallAnalysis {
  const { accountId, games, heroName, items } = input
  const facts = input.details
    .map((d) => factsFor(d, accountId, heroName, items))
    .filter((f): f is GameFacts => f != null)
    .sort((a, b) => b.startTime - a.startTime)
  const impactById = new Map(facts.map((f) => [f.matchId, f.impact]))

  const trend: TrendPoint[] = games
    .slice(0, TREND_GAMES)
    .map((g) => ({
      matchId: g.matchId,
      startTime: g.startTime,
      heroId: g.heroId,
      won: g.won,
      soulsPerMin: g.netWorth / Math.max(1, g.durationS / 60),
      kda: (g.kills + g.assists) / Math.max(1, g.deaths),
      deaths: g.deaths,
      impact: impactById.get(g.matchId) ?? null,
    }))
    .reverse()

  const recent = games.slice(0, RECENT)
  const previous = games.slice(RECENT, RECENT + PREVIOUS)
  const avg = (gs: HistoryGame[], f: (g: HistoryGame) => number) => (gs.length ? gs.reduce((a, g) => a + f(g), 0) / gs.length : 0)
  const compare: PeriodStat[] = []
  if (recent.length >= 5 && previous.length >= 5) {
    compare.push(
      { label: 'Win rate', recent: avg(recent, (g) => (g.won ? 1 : 0)), previous: avg(previous, (g) => (g.won ? 1 : 0)), better: 'higher', format: 'pct' },
      { label: 'Souls/min', recent: avg(recent, (g) => g.netWorth / Math.max(1, g.durationS / 60)), previous: avg(previous, (g) => g.netWorth / Math.max(1, g.durationS / 60)), better: 'higher', format: 'int' },
      { label: 'Deaths/game', recent: avg(recent, (g) => g.deaths), previous: avg(previous, (g) => g.deaths), better: 'lower', format: 'dec' },
      { label: 'KDA', recent: avg(recent, (g) => (g.kills + g.assists) / Math.max(1, g.deaths)), previous: avg(previous, (g) => (g.kills + g.assists) / Math.max(1, g.deaths)), better: 'higher', format: 'dec' },
    )
    const imp = (gs: HistoryGame[]) => gs.flatMap((g) => (impactById.has(g.matchId) ? [impactById.get(g.matchId)!] : []))
    const ri = imp(recent)
    const pi = imp(previous)
    if (ri.length >= MIN_SIDE && pi.length >= MIN_SIDE) {
      compare.push({ label: 'Impact score', recent: ri.reduce((a, b) => a + b, 0) / ri.length, previous: pi.reduce((a, b) => a + b, 0) / pi.length, better: 'higher', format: 'int' })
    }
  }

  return {
    totalGames: games.length,
    analyzedGames: facts.length,
    wins: games.filter((g) => g.won).length,
    habits: habits(facts, PROBLEMS, 'bad'),
    strengths: habits(facts, STRENGTHS, 'good'),
    winConditions: winConditions(facts),
    trend,
    recentWindow: RECENT,
    compare,
    sessions: sessions(games),
    heroes: heroSummaries(games, facts.map((f) => f.hero)),
    deaths: deathsSummary(
      facts.map((f) => ({ points: f.deathPoints, fights: f.fights, lobby: f.lobbyDeaths })),
      heroName,
    ),
  }
}
