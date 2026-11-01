import type { ItemInfo, ItemTag } from '../../assets/types'
import { formatDuration, formatSouls } from '../../../lib/format'
import type { MatchDetailData, MatchDetailPlayer, MatchSnapshot } from '../validators/match-detail'
import { COUNTER_ROLES, HERO_COUNTERS, type CounterRole } from '../data/hero-counters'

// Shared building blocks for match analysis and the coach review: lobby
// stats helpers, fight detection, building/lane mapping and counter-item
// coverage. Pure.

export interface CounterItem {
  name: string
  t: number
}

export interface CoverageRow {
  accountId: number
  name: string
  heroId: number
  pos: number
  /** First purchase of each kind of counter item, if any. */
  antiHeal: CounterItem | null
  bulletResist: CounterItem | null
  spiritResist: CounterItem | null
  shred: CounterItem | null
}

export interface CounterReport {
  /** Enemy heroes who healed well above the lobby norm. */
  healers: { accountId: number; heroId: number; name: string; healing: number }[]
  enemyHealing: number
  /** Enemy healing as a share of your team's hero damage. */
  healShare: number
  /** Estimated share of enemy hero damage coming from spirit builds, 0..1. */
  spiritShare: number | null
  needs: { antiHeal: boolean; bulletResist: boolean; spiritResist: boolean }
  rows: CoverageRow[]
  /** Every enemy hero, most dangerous first, with their counter items. */
  threats: Threat[]
  /** False when the item list has no counter tags (e.g. an outdated main process): tag-based columns are unknown, not missing. */
  tagsLoaded: boolean
}

export interface ThreatCounter {
  name: string
  itemId: number | null
  role: CounterRole
  /** Your players who bought it, earliest first. */
  buyers: { accountId: number; heroId: number; name: string; t: number }[]
}

export interface Threat {
  accountId: number
  heroId: number
  name: string
  kills: number
  deaths: number
  damage: number
  /** Share of their team's kills / hero damage. */
  killShare: number
  damageShare: number
  /** 0..1, average of the two shares. */
  score: number
  /** Your player this hero killed the most. */
  topVictim: { accountId: number; heroId: number; kills: number } | null
  counters: ThreatCounter[]
}

export const LANE_END_S = 540 // stats snapshot closest to the usual end of laning
export const FIGHT_GAP_S = 15 // deaths closer than this belong to the same fight
export const BIG_ITEM_COST = 3000
export const ANTI_HEAL_LATE_S = 1320 // anti-heal after 22:00, vs a healing comp, counts as late
export const COSTLY_DEATH_S = 60 // an objective lost this soon after a death is blamed on it

export type Objective = MatchDetailData['objectives'][number]

/**
 * In-game lane names by assigned_lane value. The values are Valve's
 * CMsgLaneColor (citadel_gcmessages_common.proto: 1 Yellow, 3 Green, 4 Blue,
 * 6 Purple), named before the map went to three lanes. On today's map
 * Yellow is York, Blue is Broadway (the middle lane) and the third lane,
 * still sent as 6, is Greenwich (green). 3 only appears in pre-2025 matches.
 */
export const LANE_NAMES: Record<number, string> = { 1: 'York', 3: 'Green lane', 4: 'Broadway', 6: 'Greenwich' }

/** "York", "Broadway", "Greenwich" (or "Lane 5" for an unknown value). */
export const laneName = (lane: number) => LANE_NAMES[lane] ?? `Lane ${lane}`

export const OBJECTIVE_NAMES: Record<number, string> = {
  0: 'Patron core',
  1: 'Guardian',
  2: 'Guardian',
  3: 'Guardian',
  4: 'Guardian',
  5: 'Walker',
  6: 'Walker',
  7: 'Walker',
  8: 'Walker',
  9: 'Patron',
  10: 'Shrine',
  11: 'Shrine',
  12: 'Base Guardian',
  13: 'Base Guardian',
  14: 'Base Guardian',
  15: 'Base Guardian',
}

// ------------------------------------------------------------------ helpers

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
export const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
export const pctStr = (x: number) => `${Math.round(x * 100)}%`
export const signedSouls = (n: number) => `${n >= 0 ? '+' : '−'}${formatSouls(Math.abs(n))}`
export const mmss = (t: number) => formatDuration(t)

/** Fraction of `values` strictly below `x`, ties counted half. 0..1 */
export function percentile(x: number, values: number[]): number {
  if (values.length <= 1) return 0.5
  let below = 0
  let equal = 0
  for (const v of values) {
    if (v < x) below++
    else if (v === x) equal++
  }
  return (below + (equal - 1) / 2) / (values.length - 1)
}

/** Rank of `x` among `values`, 1 = largest. */
export const rankDesc = (x: number, values: number[]) => 1 + values.filter((v) => v > x).length

export function snapshotAt(p: MatchDetailPlayer, t: number): MatchSnapshot | null {
  if (p.snapshots.length === 0) return null
  let best = p.snapshots[0]!
  for (const s of p.snapshots) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
  return best
}

export function firstBigItemAt(p: MatchDetailPlayer, items: Record<number, ItemInfo>): number | null {
  const big = p.items.filter((i) => (items[i.itemId]?.cost ?? 0) >= BIG_ITEM_COST).map((i) => i.t)
  return big.length ? Math.min(...big) : null
}

export const names = (ps: MatchDetailPlayer[], hero: (id: number) => string) => ps.map((p) => hero(p.heroId)).join(' & ')

// ------------------------------------------------------------------- fights

export interface FightDeath {
  t: number
  p: MatchDetailPlayer
  killerSlot: number | null
}

export interface Fight {
  start: number
  end: number
  deaths: FightDeath[]
  ourDeaths: MatchDetailPlayer[]
  theirDeaths: MatchDetailPlayer[]
}

/** Deaths within FIGHT_GAP_S of each other, as fights with at least `minDeaths` deaths. */
export function findFights(players: MatchDetailPlayer[], team: number, minDeaths = 3): Fight[] {
  const deaths = allDeaths(players)
  const fights: Fight[] = []
  let cur: Fight | null = null
  for (const d of deaths) {
    if (!cur || d.t - cur.end > FIGHT_GAP_S) {
      cur = { start: d.t, end: d.t, deaths: [], ourDeaths: [], theirDeaths: [] }
      fights.push(cur)
    }
    cur.end = d.t
    cur.deaths.push(d)
    ;(d.p.team === team ? cur.ourDeaths : cur.theirDeaths).push(d.p)
  }
  return fights.filter((f) => f.deaths.length >= minDeaths)
}

export function allDeaths(players: MatchDetailPlayer[]): FightDeath[] {
  return players.flatMap((p) => p.deathDetails.map((d) => ({ t: d.t, p, killerSlot: d.killerSlot }))).sort((a, b) => a.t - b.t)
}

export const isDeadAt = (p: MatchDetailPlayer, t: number) => p.deathDetails.some((d) => d.t <= t && t <= d.t + d.respawnS)

// ------------------------------------------------------------------ buildings

/** Lane index 1–4 used by objective ids (Guardians 1–4, Walkers 5–8, Base Guardians 12–15). */
export function objectiveLane(id: number): number | null {
  if (id >= 1 && id <= 4) return id
  if (id >= 5 && id <= 8) return id - 4
  if (id >= 12 && id <= 15) return id - 11
  return null
}

/**
 * Players' assigned lanes (1/4/6 on the current map) and objective lanes
 * (1/3/4) are numbered differently. Both run in the same map order, so
 * pair them up by rank. Returns null when the lane counts don't line up.
 */
export function laneMapping(players: MatchDetailPlayer[]): Map<number, number> | null {
  const assigned = [...new Set(players.map((p) => p.lane).filter((l): l is number => l != null))].sort((a, b) => a - b)
  const objective = assigned.length === 3 ? [1, 3, 4] : assigned.length === 4 ? [1, 2, 3, 4] : null
  if (!objective) return null
  return new Map(objective.map((o, i) => [o, assigned[i]!]))
}

// ------------------------------------------------------------------ counters

export function firstTagged(p: MatchDetailPlayer, tag: ItemTag, items: Record<number, ItemInfo>): CounterItem | null {
  let best: CounterItem | null = null
  for (const i of p.items) {
    const info = items[i.itemId]
    if (info?.tags?.includes(tag) && (!best || i.t < best.t)) best = { name: info.name, t: i.t }
  }
  return best
}

/** Souls spent per item slot (sold items included: they shaped the fights while held). */
export function slotSpend(p: MatchDetailPlayer, items: Record<number, ItemInfo>) {
  const spend = { weapon: 0, vitality: 0, spirit: 0 }
  for (const i of p.items) {
    const info = items[i.itemId]
    if (info && info.slot !== 'other') spend[info.slot] += info.cost ?? 0
  }
  return spend
}

/** 0..1, how far a build leans spirit over weapon. null = no weapon/spirit items. */
export function spiritLean(p: MatchDetailPlayer, items: Record<number, ItemInfo>): number | null {
  const s = slotSpend(p, items)
  return s.weapon + s.spirit > 0 ? s.spirit / (s.weapon + s.spirit) : null
}

export const HEALER_MIN = 5000
export const HEALER_VS_MEDIAN = 1.4
export const ANTI_HEAL_MIN_HEALING = 15000 // total enemy healing below this isn't worth an item slot
export const SPIRIT_HEAVY = 0.6

/** A hero counts as a major threat (and gets coaching calls) above this score. */
export const MAJOR_THREAT = 0.22
export const MAJOR_THREAT_KILLS = 6

function threatsFor(ours: MatchDetailPlayer[], theirs: MatchDetailPlayer[], items: Record<number, ItemInfo>, heroName: (id: number) => string): Threat[] {
  const idsByName = new Map<string, number>()
  for (const i of Object.values(items)) if (!idsByName.has(i.name) || i.tags?.length) idsByName.set(i.name, i.id)
  const teamKills = Math.max(1, sum(theirs.map((p) => p.kills)))
  const teamDamage = Math.max(1, sum(theirs.map((p) => p.damage ?? 0)))
  return theirs
    .map((p) => {
      const killShare = p.kills / teamKills
      const damageShare = (p.damage ?? 0) / teamDamage
      let topVictim: Threat['topVictim'] = null
      for (const v of ours) {
        const kills = p.slot == null ? 0 : v.deathDetails.filter((d) => d.killerSlot === p.slot).length
        if (kills > 0 && (!topVictim || kills > topVictim.kills)) topVictim = { accountId: v.accountId, heroId: v.heroId, kills }
      }
      const counters = (HERO_COUNTERS[heroName(p.heroId)] ?? []).map((name): ThreatCounter => {
        const itemId = idsByName.get(name) ?? null
        const buyers = ours
          .flatMap((q) => {
            const buy = q.items.filter((i) => i.itemId === itemId).sort((a, b) => a.t - b.t)[0]
            return buy ? [{ accountId: q.accountId, heroId: q.heroId, name: q.name, t: buy.t }] : []
          })
          .sort((a, b) => a.t - b.t)
        return { name, itemId, role: COUNTER_ROLES[name] ?? 'protect', buyers }
      })
      return {
        accountId: p.accountId,
        heroId: p.heroId,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        damage: p.damage ?? 0,
        killShare,
        damageShare,
        score: (killShare + damageShare) / 2,
        topVictim,
        counters,
      }
    })
    .sort((a, b) => b.score - a.score)
}

export function countersFor(
  players: MatchDetailPlayer[],
  team: number,
  items: Record<number, ItemInfo>,
  posOf: (p: MatchDetailPlayer) => number,
  heroName: (id: number) => string,
): CounterReport {
  const ours = players.filter((p) => p.team === team)
  const theirs = players.filter((p) => p.team !== team)
  // player_healing already includes self-healing.
  const healOf = (p: MatchDetailPlayer) => p.healing ?? 0
  const threshold = Math.max(HEALER_MIN, median(players.map(healOf)) * HEALER_VS_MEDIAN)
  const healers = theirs
    .filter((p) => healOf(p) >= threshold)
    .sort((a, b) => healOf(b) - healOf(a))
    .map((p) => ({ accountId: p.accountId, heroId: p.heroId, name: p.name, healing: healOf(p) }))
  const enemyHealing = sum(theirs.map(healOf))
  const ourDamage = sum(ours.map((p) => p.damage ?? 0))
  const healShare = ourDamage > 0 ? enemyHealing / ourDamage : 0

  let weighted = 0
  let total = 0
  for (const p of theirs) {
    const lean = spiritLean(p, items)
    if (lean == null || !p.damage) continue
    weighted += lean * p.damage
    total += p.damage
  }
  const spiritShare = total > 0 ? weighted / total : null

  return {
    healers,
    enemyHealing,
    healShare,
    spiritShare,
    needs: {
      antiHeal: enemyHealing >= ANTI_HEAL_MIN_HEALING && (healers.length >= 2 || healShare >= 0.3),
      spiritResist: spiritShare != null && spiritShare >= SPIRIT_HEAVY,
      bulletResist: spiritShare != null && spiritShare <= 1 - SPIRIT_HEAVY,
    },
    rows: [...ours]
      .sort((a, b) => posOf(a) - posOf(b))
      .map((p) => ({
        accountId: p.accountId,
        name: p.name,
        heroId: p.heroId,
        pos: posOf(p),
        antiHeal: firstTagged(p, 'antiHeal', items),
        bulletResist: firstTagged(p, 'bulletResist', items),
        spiritResist: firstTagged(p, 'spiritResist', items),
        shred: firstTagged(p, 'shred', items),
      })),
    threats: threatsFor(ours, theirs, items, heroName),
    tagsLoaded: Object.values(items).some((i) => Array.isArray(i.tags)),
  }
}

/** Cheapest items with a tag, for "buy X or Y" advice. */
export function optionsFor(tag: ItemTag, items: Record<number, ItemInfo>, n = 3): string {
  const list = Object.values(items)
    .filter((i) => i.tags?.includes(tag) && (i.cost ?? 0) > 0)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((i) => i.name)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`
}

// ------------------------------------------------------------------ analysis
