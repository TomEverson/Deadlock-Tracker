import type { MatchDetailData } from '../validators/match-detail'
import type { Area, Finding, MatchAnalysis, Tone } from './analysis'
import { findFights, signedSouls, isDeadAt, LANE_END_S, laneName, mmss, OBJECTIVE_NAMES, sum, type Fight } from './match-facts'
import { fightCenter, fightPresence, mapGeometry, zoneOf, type Pos } from './positions'

// The coach's read of a match, built on top of analyzeMatch: what decided
// the game, how each phase went, a review of every big fight, and the three
// things the viewer should fix next game. Pure.

export type PhaseKey = 'laning' | 'mid' | 'late'

export interface PhaseReview {
  key: PhaseKey
  label: string
  from: number
  to: number
  /** Your team's soul lead at the start and end of the phase. */
  leadStart: number
  leadEnd: number
  kills: number
  deaths: number
  taken: string[]
  lost: string[]
  tone: Tone
  summary: string
}

export interface FightReview {
  t: number
  /** 4+ deaths = team fight; fewer = skirmish. */
  kind: 'teamfight' | 'skirmish'
  /** Where it happened (needs positions): "Mina & Yamato lane", "jungle", "enemy base"… */
  where: string | null
  ourDeaths: number
  theirDeaths: number
  result: 'won' | 'lost' | 'even'
  /** First hero to die: whoever lost them started the fight a hero down. */
  openedBy: { heroId: number; name: string; ours: boolean } | null
  /** Your players who were alive but not there when it started: arrived late, or never came (without positions: no kill or death in it). */
  missing: { accountId: number; heroId: number; name: string; late: boolean }[]
  taken: string[]
  lost: string[]
  leadBefore: number
  /** Everyone who died in it, in order. */
  deaths: FightDeathReview[]
  /**
   * Estimated soul swing for your team (+ = you gained on them): each death is
   * worth what the killing team earned from kills, plus what the victim
   * dropped, averaged over that stats window. Null for matches saved before v4.
   */
  souls: number | null
}

export interface FightDeathReview {
  t: number
  accountId: number
  heroId: number
  name: string
  ours: boolean
  killerHeroId: number | null
  /** Estimated souls this death was worth to the other team. */
  value: number | null
}

export interface FocusPoint {
  title: string
  detail?: string
  area: Area
}

export interface MapDeath {
  t: number
  pos: Pos
  heroId: number
  accountId: number
  /** Died on your team (red) or theirs (green). */
  ours: boolean
  killerHeroId: number | null
}

export interface DeathMap {
  /** Lane x centers, left to right. */
  lanes: number[]
  xRange: [number, number]
  /** Your base's y and the enemy base's y, so the map can put yours at the bottom. */
  ourBaseY: number
  enemyBaseY: number
  deaths: MapDeath[]
}

export interface CoachReview {
  headline: string
  story: string
  phases: PhaseReview[]
  decisive: { t: number; text: string; tone: Tone } | null
  fights: FightReview[]
  /** Every death plotted on the map; null for matches saved without positions. */
  deathMap: DeathMap | null
  /** False for matches saved before positions were stored (rotation calls use timing only). */
  hasPositions: boolean
  /** Who the focus points are for: 'you', a player's name, or 'your team'. */
  focusFor: string
  focus: FocusPoint[]
}

const MID_END_S = 1200
const SWING = 1500 // soul change that makes a phase clearly won or lost
const FIGHT_FOLLOWUP_S = 75

const objName = (id: number) => OBJECTIVE_NAMES[id] ?? 'objective'

export function coachReview(
  detail: MatchDetailData,
  analysis: MatchAnalysis,
  heroName: (id: number) => string,
  viewer: { accountId: number; isSelf: boolean } | null,
): CoachReview {
  const { team, won } = analysis
  const players = detail.players
  const ours = players.filter((p) => p.team === team)

  const timeline = [{ t: 0, d: 0 }, ...detail.netWorthTimeline.map((pt) => ({ t: pt.t, d: team === 0 ? pt.team0 - pt.team1 : pt.team1 - pt.team0 }))]
  const leadAt = (t: number) => timeline.reduce((best, pt) => (Math.abs(pt.t - t) < Math.abs(best.t - t) ? pt : best)).d

  // ---- phases
  const end = detail.durationS
  const bounds: [PhaseKey, string, number, number][] = [
    ['laning', 'Laning', 0, Math.min(LANE_END_S, end)],
    ['mid', 'Mid game', LANE_END_S, Math.min(MID_END_S, end)],
    ['late', 'Late game', MID_END_S, end],
  ]
  const phases: PhaseReview[] = bounds
    .filter(([, , from, to]) => to - from >= 60)
    .map(([key, name, from, to]) => {
      const inPhase = (t: number) => t > from && t <= to
      const leadStart = leadAt(from)
      const leadEnd = to === end ? (timeline.at(-1)?.d ?? leadAt(to)) : leadAt(to)
      const delta = leadEnd - leadStart
      const deaths = sum(ours.map((p) => p.deathDetails.filter((d) => inPhase(d.t)).length))
      const kills = sum(players.filter((p) => p.team !== team).map((p) => p.deathDetails.filter((d) => inPhase(d.t)).length))
      const objs = detail.objectives.filter((o) => o.id !== 0 && inPhase(o.t))
      const taken = objs.filter((o) => o.team !== team).map((o) => objName(o.id))
      const lost = objs.filter((o) => o.team === team).map((o) => objName(o.id))
      for (const m of detail.midBoss.filter((m) => inPhase(m.t))) (m.teamClaimed === team ? taken : lost).push('Mid-Boss')
      const tone: Tone = delta >= SWING ? 'good' : delta <= -SWING ? 'bad' : 'info'

      const parts: string[] = [`${signedSouls(delta)} souls`, `${kills}–${deaths} in kills`]
      if (key === 'laning' && analysis.lanes.length) {
        const wonLanes = analysis.lanes.filter((l) => l.soulDiff >= 500).length
        const lostLanes = analysis.lanes.filter((l) => l.soulDiff <= -500).length
        parts.push(`lanes ${wonLanes} won, ${lostLanes} lost`)
      }
      if (taken.length) parts.push(`took ${countList(taken)}`)
      if (lost.length) parts.push(`lost ${countList(lost)}`)
      return { key, label: `${name} (${mmss(from)}–${mmss(to)})`, from, to, leadStart, leadEnd, kills, deaths, taken, lost, tone, summary: parts.join(' · ') }
    })

  // ---- fights: every cluster of 2+ deaths
  const geo = mapGeometry(detail)
  const whereOf = (f: Fight): string | null => {
    const c = geo ? fightCenter(f) : null
    if (!geo || !c) return null
    const z = zoneOf(c, geo)
    return z.kind === 'lane' ? laneName(z.lane) : z.kind === 'jungle' ? (z.district ?? 'jungle') : z.team === team ? 'your base' : 'enemy base'
  }
  // What a death of `victimTeam` was worth around time t: souls the other team
  // earned from hero kills, plus souls the victims dropped, over the stats
  // window containing t, split evenly across that window's deaths.
  const snapTimes = [0, ...(players[0]?.snapshots.map((s) => s.t) ?? [])]
  const cumulative = (p: (typeof players)[number], t: number, key: 'heroSouls' | 'soulsLost') => (t === 0 ? 0 : (p.snapshots.find((s) => s.t === t)?.[key] ?? null))
  const deathValue = (victimTeam: number, t: number): number | null => {
    const i = snapTimes.findIndex((st) => st >= t)
    if (i <= 0) return null
    const [t0, t1] = [snapTimes[i - 1]!, snapTimes[i]!]
    let earned = 0
    let dropped = 0
    for (const p of players) {
      const key = p.team === victimTeam ? 'soulsLost' : 'heroSouls'
      const a = cumulative(p, t0, key)
      const b = cumulative(p, t1, key)
      if (a == null || b == null) return null
      if (p.team === victimTeam) dropped += b - a
      else earned += b - a
    }
    const deaths = sum(players.filter((p) => p.team === victimTeam).map((p) => p.deathDetails.filter((d) => d.t > t0 && d.t <= t1).length))
    return deaths > 0 ? (earned + dropped) / deaths : null
  }
  const slotHero = new Map(players.filter((p) => p.slot != null).map((p) => [p.slot!, p.heroId]))

  const reviewed: FightReview[] = findFights(players, team, 2).map((f) => {
    const deaths: FightDeathReview[] = f.deaths.map((d) => ({
      t: d.t,
      accountId: d.p.accountId,
      heroId: d.p.heroId,
      name: d.p.name,
      ours: d.p.team === team,
      killerHeroId: d.killerSlot != null ? (slotHero.get(d.killerSlot) ?? null) : null,
      value: deathValue(d.p.team, d.t),
    }))
    const souls = deaths.some((d) => d.value == null) ? null : Math.round(sum(deaths.map((d) => (d.ours ? -d.value! : d.value!))))
    const followup = detail.objectives.filter((o) => o.id !== 0 && o.t >= f.start && o.t <= f.end + FIGHT_FOLLOWUP_S)
    const boss = detail.midBoss.filter((m) => m.t >= f.start && m.t <= f.end + FIGHT_FOLLOWUP_S)
    const first = f.deaths[0]
    const diff = f.theirDeaths.length - f.ourDeaths.length
    return {
      t: f.start,
      kind: f.deaths.length >= 4 ? 'teamfight' : 'skirmish',
      where: whereOf(f),
      ourDeaths: f.ourDeaths.length,
      theirDeaths: f.theirDeaths.length,
      result: diff >= 2 ? 'won' : diff <= -2 ? 'lost' : 'even',
      openedBy: first ? { heroId: first.p.heroId, name: first.p.name, ours: first.p.team === team } : null,
      missing: ours
        .filter((p) => !isDeadAt(p, f.start - 1))
        .flatMap((p) => {
          const presence = fightPresence(p, f, geo)
          return presence === 'there' ? [] : [{ accountId: p.accountId, heroId: p.heroId, name: p.name, late: presence === 'late' }]
        }),
      taken: [...followup.filter((o) => o.team !== team).map((o) => objName(o.id)), ...boss.filter((m) => m.teamClaimed === team).map(() => 'Mid-Boss')],
      lost: [...followup.filter((o) => o.team === team).map((o) => objName(o.id)), ...boss.filter((m) => m.teamClaimed !== team).map(() => 'Mid-Boss')],
      leadBefore: leadAt(f.start),
      deaths,
      souls,
    }
  })

  // ---- death map
  const deathMap: DeathMap | null = geo
    ? {
        lanes: [...geo.laneX.values()].sort((a, b) => a - b),
        xRange: [Math.min(...geo.laneX.values()) - geo.laneHalfWidth, Math.max(...geo.laneX.values()) + geo.laneHalfWidth],
        ourBaseY: geo.baseY[team]!,
        enemyBaseY: geo.baseY[1 - team]!,
        deaths: players.flatMap((p) =>
          p.deathDetails.flatMap((d) =>
            d.pos
              ? [{ t: d.t, pos: d.pos, heroId: p.heroId, accountId: p.accountId, ours: p.team === team, killerHeroId: players.find((k) => k.slot != null && k.slot === d.killerSlot)?.heroId ?? null }]
              : [],
          ),
        ),
      }
    : null

  // ---- decisive moment: the fight that swung the game toward the result
  const objValue = (names: string[]) => sum(names.map((n) => (n === 'Patron' || n === 'Patron core' ? 4 : n === 'Shrine' || n === 'Mid-Boss' ? 3 : n === 'Base Guardian' ? 2 : 1)))
  const decisiveFight = reviewed
    .filter((r) => r.result === (won ? 'won' : 'lost'))
    .map((r) => ({ r, impact: Math.abs(r.theirDeaths - r.ourDeaths) + objValue(won ? r.taken : r.lost) * 1.5 + (r.t > MID_END_S ? 1 : 0) }))
    .sort((a, b) => b.impact - a.impact)[0]?.r
  const decisive = decisiveFight
    ? {
        t: decisiveFight.t,
        tone: (won ? 'good' : 'bad') as Tone,
        text: [
          `${won ? 'Won' : 'Lost'} the ${mmss(decisiveFight.t)} fight ${decisiveFight.theirDeaths}–${decisiveFight.ourDeaths}`,
          decisiveFight.openedBy ? ` (${heroName(decisiveFight.openedBy.heroId)} died first)` : '',
          (won ? decisiveFight.taken : decisiveFight.lost).length ? ` → ${won ? 'took' : 'lost'} ${countList(won ? decisiveFight.taken : decisiveFight.lost)}` : '',
          '.',
        ].join(''),
      }
    : null

  // ---- headline + story
  const peak = Math.max(...timeline.map((pt) => pt.d))
  const trough = Math.min(...timeline.map((pt) => pt.d))
  const laning = phases.find((p) => p.key === 'laning')
  const laningDelta = laning ? laning.leadEnd - laning.leadStart : 0
  const headline = won
    ? trough <= -5000
      ? `Comeback win from ${signedSouls(trough).slice(1)} behind`
      : trough > -SWING
        ? end < 1500 || analysis.finalSoulDiff > 20000
          ? 'Stomp: ahead from start to finish'
          : 'Controlled win: never fell behind'
        : 'Won the late game'
    : peak >= 5000
      ? `Threw a ${signedSouls(peak).slice(1)} lead`
      : laningDelta <= -3000
        ? 'Lost the lanes and never recovered'
        : peak < SWING
          ? 'Behind all game'
          : 'Close game, lost late'

  const phrase = (p: PhaseReview): string => {
    const d = p.leadEnd - p.leadStart
    const amount = `(${signedSouls(d)})`
    if (p.key === 'laning') return d >= SWING ? `won laning ${amount}` : d <= -SWING ? `lost laning ${amount}` : 'laning was even'
    if (p.key === 'mid') return d >= SWING ? `pulled ahead in the mid game ${amount}` : d <= -SWING ? `fell behind in the mid game ${amount}` : 'the mid game was even'
    return d >= SWING ? `won the late game ${amount}` : d <= -SWING ? `lost the late game ${amount}` : 'the late game was close'
  }
  const story = capitalize(phases.map(phrase).join(', ')) + (decisive ? `. Turning point: ${decisive.text.charAt(0).toLowerCase()}${decisive.text.slice(1)}` : '.')

  // ---- focus: the viewer's biggest problems, one per area, most important first
  const viewerReport = viewer ? analysis.players.find((r) => r.accountId === viewer.accountId) : undefined
  const source: Finding[] = viewerReport ? viewerReport.findings : analysis.wentWrong
  const seen = new Set<Area>()
  const focus: FocusPoint[] = []
  for (const f of [...source].filter((x) => x.tone === 'bad').sort((a, b) => b.weight - a.weight)) {
    if (seen.has(f.area)) continue
    seen.add(f.area)
    focus.push({ title: f.title, detail: f.detail, area: f.area })
    if (focus.length === 3) break
  }
  // A clean individual game still has team problems worth fixing.
  for (const f of analysis.wentWrong) {
    if (focus.length === 3) break
    if (focus.some((x) => x.title === f.title)) continue
    focus.push({ title: f.title, detail: f.detail, area: f.area })
  }
  const focusFor = viewerReport ? (viewer!.isSelf ? 'you' : viewerReport.name) : 'your team'

  return { headline, story, phases, decisive, fights: reviewed, deathMap, hasPositions: geo != null, focusFor, focus }
}

function countList(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}s` : n)).join(', ')
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
