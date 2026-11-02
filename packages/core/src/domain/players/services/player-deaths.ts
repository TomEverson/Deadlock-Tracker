import type { CoachReview } from '../../matches/services/coach'
import { laneName, LANE_END_S } from '../../matches/services/match-facts'
import { alliesNear, mapGeometry, zoneOf, type MapGeometry } from '../../matches/services/positions'
import type { MatchDetailData, MatchDetailPlayer } from '../../matches/validators/match-detail'

// Where and how a player dies across their games, plus how they show up to
// fights. Pure. Positions are normalized so games stack on one schematic map:
// your base at the bottom, York on the left, whichever team you were on.

export type DeathArea = 'own-base' | 'own-jungle' | 'lane-own' | 'lane-enemy' | 'enemy-jungle' | 'enemy-base'
export type Phase = 'laning' | 'mid' | 'late'

export interface DeathPoint {
  matchId: number
  t: number
  /** 0 = York side, 1 = Greenwich side. */
  u: number
  /** 0 = your base, 1 = the enemy base. */
  v: number
  area: DeathArea
  /** "York", "Chinatown", "enemy base"… */
  place: string
  phase: Phase
  /** No living teammate nearby when you died. */
  alone: boolean
  killerHeroId: number | null
  won: boolean
}

/** Team fight participation in one game (4+ deaths; skirmishes across the map aren't fights you could always join). */
export interface FightFacts {
  /** Fights where you were alive when it started. */
  possible: number
  there: number
  late: number
  missing: number
  /** Fight results (team deaths difference ≥ 2) when you were there vs not. */
  thereWon: number
  thereLost: number
  awayWon: number
  awayLost: number
  /** Fights you started by dying first, and how many of those were lost. */
  diedFirst: number
  diedFirstLost: number
}

/** Everyone in the lobby's deaths in one game, for a fair comparison. */
export interface LobbyDeaths {
  players: number
  phases: Record<Phase, number>
  alone: number
  total: number
  /** Seconds of the game in each phase. */
  phaseS: Record<Phase, number>
}

export interface PhaseRate {
  phase: Phase
  /** Deaths per 10 minutes of that phase: yours vs the average player in your lobbies. */
  you: number
  lobby: number
  deaths: number
}

export interface PlaceCount {
  place: string
  area: DeathArea
  deaths: number
}

export interface Killer {
  heroId: number
  kills: number
  games: number
}

export interface DeathsSummary {
  /** Games with positions, out of the detailed games. */
  games: number
  points: DeathPoint[]
  areas: Record<DeathArea, number>
  places: PlaceCount[]
  phases: Record<Phase, number>
  phaseRates: PhaseRate[]
  alone: number
  /** Share of everyone's deaths in your lobbies with no teammate nearby. */
  lobbyAlone: number | null
  /** Deaths past the middle of the map. */
  enemyHalf: number
  killers: Killer[]
  fights: FightFacts & { games: number }
  /** The coach's reading, most important first. */
  insights: { tone: 'bad' | 'good' | 'info'; text: string }[]
}

const MID_END_S = 1200
/** Hidden King's (team 0) districts; the other two are Archmother's. */
const TEAM0_DISTRICTS = new Set(['Haunted Lot', 'Chinatown'])
const YORK = 1
const GREENWICH = 6

const phaseOf = (t: number): Phase => (t < LANE_END_S ? 'laning' : t < MID_END_S ? 'mid' : 'late')

function normalize(pos: [number, number], geo: MapGeometry, team: number): { u: number; v: number } {
  const xs = [...geo.laneX.values()]
  const x0 = Math.min(...xs) - geo.laneHalfWidth
  const x1 = Math.max(...xs) + geo.laneHalfWidth
  let u = (pos[0] - x0) / (x1 - x0)
  const york = geo.laneX.get(YORK)
  const greenwich = geo.laneX.get(GREENWICH)
  if (york != null && greenwich != null && york > greenwich) u = 1 - u
  const own = geo.baseY[team]!
  const enemy = geo.baseY[1 - team]!
  const v = (pos[1] - own) / (enemy - own)
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return { u: clamp(u), v: clamp(v) }
}

const phaseSeconds = (durationS: number): Record<Phase, number> => ({
  laning: Math.min(durationS, LANE_END_S),
  mid: Math.min(Math.max(0, durationS - LANE_END_S), MID_END_S - LANE_END_S),
  late: Math.max(0, durationS - MID_END_S),
})

export function lobbyDeaths(detail: MatchDetailData): LobbyDeaths | null {
  const geo = mapGeometry(detail)
  if (!geo) return null
  const out: LobbyDeaths = { players: detail.players.length, phases: { laning: 0, mid: 0, late: 0 }, alone: 0, total: 0, phaseS: phaseSeconds(detail.durationS) }
  for (const p of detail.players)
    for (const d of p.deathDetails) {
      out.total++
      out.phases[phaseOf(d.t)]++
      if (d.pos && alliesNear(p, detail.players, d.pos, Math.max(0, d.t - 2), geo) === 0) out.alone++
    }
  return out
}

export function deathPoints(detail: MatchDetailData, me: MatchDetailPlayer): DeathPoint[] {
  const geo = mapGeometry(detail)
  if (!geo) return []
  const won = detail.winningTeam === me.team
  const bySlot = new Map(detail.players.filter((p) => p.slot != null).map((p) => [p.slot!, p.heroId]))
  return me.deathDetails.flatMap((d): DeathPoint[] => {
    if (!d.pos) return []
    const { u, v } = normalize(d.pos, geo, me.team)
    const z = zoneOf(d.pos, geo)
    let area: DeathArea
    let place: string
    if (z.kind === 'base') {
      area = z.team === me.team ? 'own-base' : 'enemy-base'
      place = z.team === me.team ? 'your base' : 'enemy base'
    } else if (z.kind === 'lane') {
      area = v > 0.5 ? 'lane-enemy' : 'lane-own'
      place = `${laneName(z.lane)}, ${v > 0.5 ? 'enemy side' : 'your side'}`
    } else {
      const own = z.district ? TEAM0_DISTRICTS.has(z.district) === (me.team === 0) : v <= 0.5
      area = own ? 'own-jungle' : 'enemy-jungle'
      place = z.district ?? (own ? 'your jungle' : 'enemy jungle')
    }
    return [
      {
        matchId: detail.matchId,
        t: d.t,
        u,
        v,
        area,
        place,
        phase: phaseOf(d.t),
        // a beat before the death: allies who died alongside you still count
        alone: alliesNear(me, detail.players, d.pos, Math.max(0, d.t - 2), geo) === 0,
        killerHeroId: d.killerSlot != null ? (bySlot.get(d.killerSlot) ?? null) : null,
        won,
      },
    ]
  })
}

export function fightFacts(review: CoachReview, me: MatchDetailPlayer): FightFacts | null {
  if (!review.hasPositions) return null
  const f: FightFacts = { possible: 0, there: 0, late: 0, missing: 0, thereWon: 0, thereLost: 0, awayWon: 0, awayLost: 0, diedFirst: 0, diedFirstLost: 0 }
  for (const fight of review.fights) {
    if (fight.kind !== 'teamfight') continue
    const diedFirst = fight.openedBy?.ours === true && fight.openedBy.heroId === me.heroId
    if (diedFirst) {
      f.diedFirst++
      if (fight.result === 'lost') f.diedFirstLost++
    }
    // alive at the start = listed as missing, or took part
    const miss = fight.missing.find((m) => m.accountId === me.accountId)
    const tookPart = !miss && !me.deathDetails.some((d) => d.t < fight.t && fight.t <= d.t + d.respawnS)
    if (!miss && !tookPart) continue
    f.possible++
    if (tookPart) f.there++
    else if (miss!.late) f.late++
    else f.missing++
    const present = tookPart
    if (fight.result === 'won') f[present ? 'thereWon' : 'awayWon']++
    if (fight.result === 'lost') f[present ? 'thereLost' : 'awayLost']++
  }
  return f
}

const AREA_LABEL: Record<DeathArea, string> = {
  'own-base': 'your base',
  'own-jungle': 'your jungle',
  'lane-own': 'the lanes on your side',
  'lane-enemy': 'the lanes past the middle',
  'enemy-jungle': 'the enemy jungle',
  'enemy-base': 'the enemy base',
}

export function deathsSummary(perGame: { points: DeathPoint[]; fights: FightFacts | null; lobby: LobbyDeaths | null }[], heroName: (id: number) => string): DeathsSummary {
  const withPos = perGame.filter((g) => g.lobby != null)
  const points = withPos.flatMap((g) => g.points)
  const games = withPos.length
  const lobbies = withPos.map((g) => g.lobby!)
  const phaseRates: PhaseRate[] = (['laning', 'mid', 'late'] as Phase[]).flatMap((phase) => {
    const seconds = lobbies.reduce((a, l) => a + l.phaseS[phase], 0)
    if (seconds < 600) return []
    const mine = points.filter((p) => p.phase === phase).length
    const everyone = lobbies.reduce((a, l) => a + l.phases[phase], 0)
    const perPlayerSeconds = lobbies.reduce((a, l) => a + l.phaseS[phase] * l.players, 0)
    return [{ phase, deaths: mine, you: (mine / seconds) * 600, lobby: (everyone / perPlayerSeconds) * 600 }]
  })
  const lobbyTotal = lobbies.reduce((a, l) => a + l.total, 0)
  const lobbyAlone = lobbyTotal ? lobbies.reduce((a, l) => a + l.alone, 0) / lobbyTotal : null
  const n = points.length
  const areas: Record<DeathArea, number> = { 'own-base': 0, 'own-jungle': 0, 'lane-own': 0, 'lane-enemy': 0, 'enemy-jungle': 0, 'enemy-base': 0 }
  const phases: Record<Phase, number> = { laning: 0, mid: 0, late: 0 }
  const placeMap = new Map<string, PlaceCount>()
  const killerMap = new Map<number, { kills: number; games: Set<number> }>()
  for (const p of points) {
    areas[p.area]++
    phases[p.phase]++
    const pc = placeMap.get(p.place) ?? { place: p.place, area: p.area, deaths: 0 }
    pc.deaths++
    placeMap.set(p.place, pc)
    if (p.killerHeroId != null) {
      const k = killerMap.get(p.killerHeroId) ?? { kills: 0, games: new Set<number>() }
      k.kills++
      k.games.add(p.matchId)
      killerMap.set(p.killerHeroId, k)
    }
  }
  const alone = points.filter((p) => p.alone).length
  const enemyHalf = points.filter((p) => p.v > 0.5).length
  const killers = [...killerMap.entries()].map(([heroId, k]) => ({ heroId, kills: k.kills, games: k.games.size })).sort((a, b) => b.kills - a.kills)

  const fightGames = perGame.flatMap((g) => (g.fights ? [g.fights] : []))
  const fights = fightGames.reduce<FightFacts & { games: number }>(
    (acc, f) => {
      for (const k of Object.keys(f) as (keyof FightFacts)[]) acc[k] += f[k]
      return acc
    },
    { possible: 0, there: 0, late: 0, missing: 0, thereWon: 0, thereLost: 0, awayWon: 0, awayLost: 0, diedFirst: 0, diedFirstLost: 0, games: fightGames.length },
  )

  // ---- the coach's reading
  const insights: DeathsSummary['insights'] = []
  const share = (x: number) => (n ? x / n : 0)
  const pctOf = (x: number) => `${Math.round(share(x) * 100)}%`
  if (n >= 10) {
    const worstArea = (Object.keys(areas) as DeathArea[]).sort((a, b) => areas[b] - areas[a])[0]!
    const topPlace = [...placeMap.values()].sort((a, b) => b.deaths - a.deaths)[0]
    if (share(areas['enemy-jungle']) >= 0.3)
      insights.push({ tone: 'bad', text: `${pctOf(areas['enemy-jungle'])} of your deaths are in the enemy jungle. Go in with your team or with vision of where their heroes are, not alone to farm their camps.` })
    if (share(alone) >= 0.35 && lobbyAlone != null && share(alone) - lobbyAlone >= 0.08)
      insights.push({ tone: 'bad', text: `${pctOf(alone)} of your deaths had no teammate nearby (${Math.round(lobbyAlone * 100)}% for players in your lobbies). Getting caught alone hands the enemy a free fight with you missing.` })
    if (share(enemyHalf) >= 0.55 && share(areas['enemy-jungle']) < 0.3)
      insights.push({ tone: 'bad', text: `${pctOf(enemyHalf)} of your deaths are past the middle of the map: you overextend. Back off once your lane is pushed and you can't see the enemy.` })
    if (share(areas['own-base'] + areas['own-jungle']) >= 0.4 && phases.late >= phases.laning)
      insights.push({ tone: 'info', text: `${pctOf(areas['own-base'] + areas['own-jungle'])} of your deaths are on your own side: you're often defending. Group with your team before the enemy reaches your buildings.` })
    const PHASE_TEXT: Record<Phase, string> = {
      laning: `in the laning phase (before ${Math.floor(LANE_END_S / 60)}:00). Early deaths cost lane souls and hand your lane opponent a lead`,
      mid: `in the mid game (${Math.floor(LANE_END_S / 60)}:00–${MID_END_S / 60}:00). Stay with your team while rotating, and don't farm the far side of the map alone`,
      late: `in the late game (after ${MID_END_S / 60}:00), when respawns are long and one death can lose an objective. Play around your team and don't take fights a hero down`,
    }
    const worstPhase = phaseRates.filter((r) => r.deaths >= 8 && r.you >= r.lobby * 1.25).sort((a, b) => b.you / b.lobby - a.you / a.lobby)[0]
    if (phaseRates.length === 3 && phaseRates.every((r) => r.you <= r.lobby * 0.75))
      insights.push({ tone: 'info', text: `You die less than the average player in your lobbies in every phase of the game. That's only good if you still deal damage and take objectives: check Heroes for whether you're playing too safe.` })
    if (worstPhase)
      insights.push({ tone: 'bad', text: `You die ${(worstPhase.you / worstPhase.lobby).toFixed(1)}× as often as the average player in your lobbies ${PHASE_TEXT[worstPhase.phase]}.` })
    if (topPlace && share(topPlace.deaths) >= 0.25 && !insights.some((i) => i.text.includes(topPlace.place)))
      insights.push({ tone: 'info', text: `You die most in ${topPlace.place} (${pctOf(topPlace.deaths)} of deaths).` })
    if (insights.length === 0) insights.push({ tone: 'info', text: `No single danger zone: most of your deaths are in ${AREA_LABEL[worstArea]} (${pctOf(areas[worstArea])}).` })
  }
  const nemesis = killers[0]
  if (nemesis && n >= 10 && nemesis.kills / n >= 0.15 && nemesis.games >= 3)
    insights.push({ tone: 'bad', text: `${heroName(nemesis.heroId)} killed you ${nemesis.kills} times over ${nemesis.games} games. Learn their kill pattern and buy the counter.` })
  if (fights.possible >= 10) {
    const rate = fights.there / fights.possible
    if (rate < 0.6) insights.push({ tone: 'bad', text: `You were there at the start of ${Math.round(rate * 100)}% of the team fights you could have joined. Watch the minimap and move when your team groups.` })
    else if (rate >= 0.8) insights.push({ tone: 'good', text: `You show up: there at the start of ${Math.round(rate * 100)}% of the team fights you could have joined.` })
    const thereDecided = fights.thereWon + fights.thereLost
    const awayDecided = fights.awayWon + fights.awayLost
    if (thereDecided >= 5 && awayDecided >= 5) {
      const wr = (w: number, d: number) => Math.round((w / d) * 100)
      const diff = fights.thereWon / thereDecided - fights.awayWon / awayDecided
      if (diff >= 0.15)
        insights.push({ tone: 'info', text: `Your team wins ${wr(fights.thereWon, thereDecided)}% of the team fights you're in and ${wr(fights.awayWon, awayDecided)}% without you: being there matters.` })
    }
  }
  if (fights.diedFirstLost >= 3 && fights.games >= 5)
    insights.push({ tone: 'bad', text: `You died first in ${fights.diedFirstLost} lost team fights. Let your frontline engage first, and keep a defensive item or escape ready.` })

  return {
    games,
    points,
    areas,
    places: [...placeMap.values()].sort((a, b) => b.deaths - a.deaths),
    phases,
    phaseRates,
    alone,
    lobbyAlone,
    enemyHalf,
    killers,
    fights,
    insights,
  }
}
