import type { MatchDetailData, MatchDetailPlayer } from '../validators/match-detail'
import { laneName } from './match-facts'

// Map geometry and position queries on v3 match details (paths + death
// positions). Pure. Everything is inferred from the match itself — no map
// file: lanes are where each lane's players stood during laning, bases are
// where each team spawned. Lanes run along y between the two bases.
// Units are trim-metadata's stored units (map units / COORD_SCALE).

export type Pos = [number, number]

export interface MapGeometry {
  /** Assigned lane → its x center. */
  laneX: Map<number, number>
  /** Half the gap between neighbouring lanes: closer than this to a lane's x counts as in it. */
  laneHalfWidth: number
  /** Spawn y per team. */
  baseY: [number, number]
  midY: number
  stepS: number
}

const LANING_SAMPLE_FROM_S = 60
const LANING_SAMPLE_TO_S = 480
const BASE_DEPTH = 0.22 // last 22% of the way to a base counts as inside it
/** Within this distance of a fight's center counts as present (~2,500 map units). */
export const PRESENCE_R = 250

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1]! : 0
}

export function mapGeometry(detail: MatchDetailData): MapGeometry | null {
  const stepS = detail.pathStepS
  if (!stepS || !detail.players.every((p) => p.path && p.path.x.length > 0)) return null
  const from = Math.round(LANING_SAMPLE_FROM_S / stepS)
  const to = Math.round(LANING_SAMPLE_TO_S / stepS)

  const byLane = new Map<number, number[]>()
  for (const p of detail.players) {
    if (p.lane == null) continue
    const xs = p.path!.x.slice(from, to)
    if (xs.length) byLane.set(p.lane, [...(byLane.get(p.lane) ?? []), medianOf(xs)])
  }
  if (byLane.size < 2) return null
  const laneX = new Map([...byLane.entries()].map(([lane, xs]) => [lane, medianOf(xs)]))
  const xs = [...laneX.values()].sort((a, b) => a - b)
  const gaps = xs.slice(1).map((x, i) => x - xs[i]!)
  const laneHalfWidth = Math.min(...gaps) / 2

  const spawn = (team: number) => medianOf(detail.players.filter((p) => p.team === team).map((p) => p.path!.y[0]!))
  const baseY: [number, number] = [spawn(0), spawn(1)]
  return { laneX, laneHalfWidth, baseY, midY: (baseY[0] + baseY[1]) / 2, stepS }
}

const idx = (geo: MapGeometry, t: number) => Math.max(0, Math.round(t / geo.stepS))

/** Position at game time t (nearest sample), or null past the end of the path. */
export function posAt(p: MatchDetailPlayer, t: number, geo: MapGeometry): Pos | null {
  const i = idx(geo, t)
  const path = p.path
  if (!path || i >= path.x.length) return null
  return [path.x[i]!, path.y[i]!]
}

/** Combat codes over [t0, t1]: 0 out, 1 vs heroes, 2 vs troopers/buildings, 3 vs neutrals. */
export function combatBetween(p: MatchDetailPlayer, t0: number, t1: number, geo: MapGeometry): number[] {
  if (!p.path) return []
  return p.path.combat.slice(idx(geo, t0), idx(geo, t1) + 1)
}

export const dist = (a: Pos, b: Pos) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * The four jungle districts (City Never Sleeps map), by which team's half
 * they're on and whether they sit on York's or Greenwich's side of
 * Broadway. Per the Deadlock Wiki: from Hidden King's side, York is left and
 * Greenwich right; Haunted Lot (by York) and Chinatown (Bell Tower, by
 * Greenwich) are Hidden King's, Plaza (by York) and Theater (by Greenwich)
 * Archmother's. Team 0 = Hidden King.
 */
const DISTRICTS: Record<number, { york: string; greenwich: string }> = {
  0: { york: 'Haunted Lot', greenwich: 'Chinatown' },
  1: { york: 'Plaza', greenwich: 'Theater' },
}
const YORK = 1
const BROADWAY = 4

export type Zone = { kind: 'lane'; lane: number } | { kind: 'jungle'; district: string | null } | { kind: 'base'; team: number }

/** Jungle district for a position off the lanes; null if the map doesn't have the York/Broadway layout. */
function districtOf([x, y]: Pos, geo: MapGeometry): string | null {
  const yorkX = geo.laneX.get(YORK)
  const midX = geo.laneX.get(BROADWAY)
  if (yorkX == null || midX == null) return null
  const half = Math.abs(y - geo.baseY[0]) <= Math.abs(y - geo.baseY[1]) ? 0 : 1
  const yorkSide = yorkX < midX ? x < midX : x > midX
  return DISTRICTS[half]![yorkSide ? 'york' : 'greenwich']
}

/** "Chinatown", "Haunted Lot"… or "the jungle" when unknown. */
export const jungleName = (z: Extract<Zone, { kind: 'jungle' }>) => z.district ?? 'the jungle'

export function zoneOf(pos: Pos, geo: MapGeometry): Zone {
  const [x, y] = pos
  for (const team of [0, 1]) {
    const base = geo.baseY[team]!
    if (Math.abs(y - base) <= Math.abs(base - geo.midY) * BASE_DEPTH) return { kind: 'base', team }
  }
  let best: { lane: number; d: number } | null = null
  for (const [lane, lx] of geo.laneX) {
    const d = Math.abs(x - lx)
    if (!best || d < best.d) best = { lane, d }
  }
  return best && best.d <= geo.laneHalfWidth * 0.45 ? { kind: 'lane', lane: best.lane } : { kind: 'jungle', district: districtOf(pos, geo) }
}

/** 0 at the midline, 1 at the enemy spawn (negative = own half). */
export function enemyDepth(pos: Pos, team: number, geo: MapGeometry): number {
  const enemyBase = geo.baseY[1 - team]!
  return (pos[1] - geo.midY) / (enemyBase - geo.midY)
}

/** Teammates (alive, by path) within `r` of `pos` at time t. */
export function alliesNear(p: MatchDetailPlayer, players: MatchDetailPlayer[], pos: Pos, t: number, geo: MapGeometry, r = PRESENCE_R): number {
  return players.filter((q) => {
    if (q === p || q.team !== p.team) return false
    const at = posAt(q, t, geo)
    const alive = !q.deathDetails.some((d) => d.t <= t && t <= d.t + d.respawnS)
    return alive && at != null && dist(at, pos) <= r
  }).length
}

// ------------------------------------------------------------------ fights

interface FightLike {
  start: number
  end: number
  deaths: { t: number; p: MatchDetailPlayer; killerSlot: number | null }[]
}

const deadAt = (p: MatchDetailPlayer, t: number) => p.deathDetails.some((d) => d.t <= t && t <= d.t + d.respawnS)

/** Where a fight happened: the average of its death positions. */
export function fightCenter(f: FightLike): Pos | null {
  const ps = f.deaths.flatMap((d) => {
    const death = d.p.deathDetails.find((x) => x.t === d.t)
    return death?.pos ? [death.pos] : []
  })
  if (ps.length === 0) return null
  return [ps.reduce((a, q) => a + q[0], 0) / ps.length, ps.reduce((a, q) => a + q[1], 0) / ps.length]
}

export type Presence = 'there' | 'late' | 'missing'

/** Joining within this long after the first death still counts as being there. */
const ON_TIME_S = 5

/**
 * Was `p` part of the fight: died in it or got a kill (= there), or with
 * paths, alive within PRESENCE_R of where it happened. Near it by the first
 * death (+ON_TIME_S) = there; only later in the fight = late. Without paths
 * only kills and deaths count, so everyone else reads as missing.
 */
export function fightPresence(p: MatchDetailPlayer, f: FightLike, geo: MapGeometry | null): Presence {
  if (f.deaths.some((d) => d.p === p || (p.slot != null && d.killerSlot === p.slot))) return 'there'
  const center = geo ? fightCenter(f) : null
  if (!geo || !center) return 'missing'
  let late = false
  for (let t = f.start - 15; t <= f.end + 5; t += geo.stepS) {
    if (deadAt(p, t)) continue
    const at = posAt(p, t, geo)
    if (!at || dist(at, center) > PRESENCE_R) continue
    if (t <= f.start + ON_TIME_S) return 'there'
    late = true
  }
  return late ? 'late' : 'missing'
}

/** Present on time (late arrivals don't count). */
export const presentInFight = (p: MatchDetailPlayer, f: FightLike, geo: MapGeometry | null) => fightPresence(p, f, geo) === 'there'

/** "farming jungle camps", "pushing York", "in the enemy base"… */
export function describeWhere(p: MatchDetailPlayer, t: number, geo: MapGeometry): string | null {
  if (deadAt(p, t)) return 'dead'
  const at = posAt(p, t, geo)
  if (!at) return null
  const zone = zoneOf(at, geo)
  const combat = combatBetween(p, t - 5, t + 5, geo)
  if (combat.includes(1)) return zone.kind === 'lane' ? `fighting in ${laneName(zone.lane)}` : zone.kind === 'jungle' && zone.district ? `fighting in ${zone.district}` : 'in a different fight'
  if (combat.includes(3)) return zone.kind === 'jungle' && zone.district ? `farming camps in ${zone.district}` : 'farming jungle camps'
  if (zone.kind === 'base') return zone.team === p.team ? 'in your base' : 'in the enemy base'
  if (zone.kind === 'lane') return combat.includes(2) ? `pushing ${laneName(zone.lane)}` : `in ${laneName(zone.lane)}`
  return zone.kind === 'jungle' ? `in ${jungleName(zone)}` : 'in the jungle'
}
