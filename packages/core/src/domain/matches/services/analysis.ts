import type { ItemInfo } from '../../assets/types'
import { formatDuration, formatSouls } from '../../../lib/format'
import type { MatchDetailData, MatchDetailPlayer, MatchSnapshot } from '../validators/match-detail'

// Rule-based match analysis. Pure: runs in the browser on the stored match
// detail (v2+), from one team's point of view. Every finding compares a
// player against the other 11 in the same lobby, so it adapts to rank and
// game length instead of using absolute "good" numbers.

export type Tone = 'good' | 'bad' | 'info'

export interface Finding {
  tone: Tone
  title: string
  detail?: string
  /** Higher = more important; used for ordering. */
  weight: number
}

export interface Moment {
  t: number
  tone: Tone
  text: string
}

export interface Metric {
  label: string
  value: string
  /** e.g. "lobby avg 612" */
  compare?: string
  tone: Tone
}

export interface PlayerReport {
  accountId: number
  name: string
  heroId: number
  team: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  /** 0–100, average lobby percentile across the impact metrics. */
  score: number
  /** 1 = highest impact score in the lobby. */
  impactRank: number
  mvpRank: number | null
  metrics: Metric[]
  findings: Finding[]
}

export interface LaneReport {
  lane: number
  ours: MatchDetailPlayer[]
  theirs: MatchDetailPlayer[]
  /** Our souls minus theirs at the end of the laning phase. */
  soulDiff: number
  lastHitDiff: number
  at: number
}

export interface MatchAnalysis {
  team: number
  won: boolean
  finalSoulDiff: number
  wentWrong: Finding[]
  wentRight: Finding[]
  moments: Moment[]
  lanes: LaneReport[]
  players: PlayerReport[]
}

const LANE_END_S = 540 // stats snapshot closest to the usual end of laning
const FIGHT_GAP_S = 15 // deaths closer than this belong to the same fight
const ANTI_HEAL_ITEMS = new Set(['Healbane', 'Toxic Bullets', 'Decay', 'Inhibitor'])
const BIG_ITEM_COST = 3000

const OBJECTIVE_NAMES: Record<number, string> = {
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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const pctStr = (x: number) => `${Math.round(x * 100)}%`
const signedSouls = (n: number) => `${n >= 0 ? '+' : '−'}${formatSouls(Math.abs(n))}`
const mmss = (t: number) => formatDuration(t)

/** Fraction of `values` strictly below `x`, ties counted half. 0..1 */
function percentile(x: number, values: number[]): number {
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
const rankDesc = (x: number, values: number[]) => 1 + values.filter((v) => v > x).length

function snapshotAt(p: MatchDetailPlayer, t: number): MatchSnapshot | null {
  if (p.snapshots.length === 0) return null
  let best = p.snapshots[0]!
  for (const s of p.snapshots) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
  return best
}

function finalItems(p: MatchDetailPlayer, items: Record<number, ItemInfo>) {
  return p.items.filter((i) => i.soldAt === null).flatMap((i) => (items[i.itemId] ? [{ ...i, info: items[i.itemId]! }] : []))
}

function firstBigItemAt(p: MatchDetailPlayer, items: Record<number, ItemInfo>): number | null {
  const big = p.items.filter((i) => (items[i.itemId]?.cost ?? 0) >= BIG_ITEM_COST).map((i) => i.t)
  return big.length ? Math.min(...big) : null
}

const names = (ps: MatchDetailPlayer[], hero: (id: number) => string) => ps.map((p) => hero(p.heroId)).join(' & ')

// ------------------------------------------------------------------- fights

interface Fight {
  start: number
  end: number
  ourDeaths: MatchDetailPlayer[]
  theirDeaths: MatchDetailPlayer[]
}

function findFights(players: MatchDetailPlayer[], team: number): Fight[] {
  const deaths = players.flatMap((p) => p.deathDetails.map((d) => ({ t: d.t, p }))).sort((a, b) => a.t - b.t)
  const fights: Fight[] = []
  let cur: Fight | null = null
  for (const d of deaths) {
    if (!cur || d.t - cur.end > FIGHT_GAP_S) {
      cur = { start: d.t, end: d.t, ourDeaths: [], theirDeaths: [] }
      fights.push(cur)
    }
    cur.end = d.t
    ;(d.p.team === team ? cur.ourDeaths : cur.theirDeaths).push(d.p)
  }
  return fights.filter((f) => f.ourDeaths.length + f.theirDeaths.length >= 3)
}

// ------------------------------------------------------------------ analysis

export function hasAnalysisData(detail: MatchDetailData): boolean {
  return detail.players.some((p) => p.snapshots.length > 0)
}

export function analyzeMatch(detail: MatchDetailData, team: number, heroName: (id: number) => string, items: Record<number, ItemInfo>): MatchAnalysis {
  const players = detail.players
  const ours = players.filter((p) => p.team === team)
  const theirs = players.filter((p) => p.team !== team)
  const won = detail.winningTeam === team
  const minutes = Math.max(1, detail.durationS / 60)
  const bySlot = new Map(players.filter((p) => p.slot != null).map((p) => [p.slot!, p]))
  const label = (p: MatchDetailPlayer) => `${p.name} (${heroName(p.heroId)})`

  const wentWrong: Finding[] = []
  const wentRight: Finding[] = []
  const moments: Moment[] = []
  const push = (f: Finding) => (f.tone === 'good' ? wentRight : wentWrong).push(f)

  // ---- soul lead over time
  const diffs = detail.netWorthTimeline.map((pt) => ({ t: pt.t, d: team === 0 ? pt.team0 - pt.team1 : pt.team1 - pt.team0 }))
  const finalSoulDiff = diffs.at(-1)?.d ?? sum(ours.map((p) => p.netWorth)) - sum(theirs.map((p) => p.netWorth))
  if (diffs.length > 1) {
    const peak = diffs.reduce((a, b) => (b.d > a.d ? b : a))
    const trough = diffs.reduce((a, b) => (b.d < a.d ? b : a))
    if (!won && peak.d > 2000) {
      push({ tone: 'bad', weight: 70 + peak.d / 500, title: `Threw a ${formatSouls(peak.d)} soul lead`, detail: `You were ahead by ${formatSouls(peak.d)} at ${mmss(peak.t)} and still lost.` })
    }
    if (won && trough.d < -2000) {
      push({ tone: 'good', weight: 60 + -trough.d / 500, title: `Came back from ${formatSouls(-trough.d)} behind`, detail: `Down ${formatSouls(-trough.d)} at ${mmss(trough.t)}.` })
    }

    // Worst and best windows between snapshots, with what happened in them.
    const windows = diffs.slice(1).map((cur, i) => ({ from: diffs[i]!.t, to: cur.t, change: cur.d - diffs[i]!.d }))
    const worst = windows.reduce((a, b) => (b.change < a.change ? b : a))
    if (worst.change < -1500) {
      const inWindow = (t: number) => t > worst.from && t <= worst.to
      const ourDeaths = sum(ours.map((p) => p.deathDetails.filter((d) => inWindow(d.t)).length))
      const theirDeaths = sum(theirs.map((p) => p.deathDetails.filter((d) => inWindow(d.t)).length))
      const lost = detail.objectives.filter((o) => o.team === team && inWindow(o.t)).map((o) => OBJECTIVE_NAMES[o.id] ?? 'objective')
      const what = [`${ourDeaths} deaths vs ${theirDeaths}`, lost.length ? `lost ${lost.join(', ')}` : null].filter(Boolean).join(', ')
      push({
        tone: 'bad',
        weight: 50 + -worst.change / 400,
        title: `Biggest swing: ${signedSouls(worst.change)} souls between ${mmss(worst.from)} and ${mmss(worst.to)}`,
        detail: `In that stretch: ${what}.`,
      })
    }
  }

  // ---- lanes (players share `lane` with their lane opponents)
  const lanes: LaneReport[] = []
  const laneIds = [...new Set(players.map((p) => p.lane).filter((l): l is number => l != null))].sort((a, b) => a - b)
  for (const lane of laneIds) {
    const o = ours.filter((p) => p.lane === lane)
    const t = theirs.filter((p) => p.lane === lane)
    if (o.length === 0 || t.length === 0) continue
    const at = snapshotAt(o[0]!, LANE_END_S)?.t ?? LANE_END_S
    const souls = (ps: MatchDetailPlayer[]) => sum(ps.map((p) => snapshotAt(p, at)?.netWorth ?? 0))
    const lh = (ps: MatchDetailPlayer[]) => sum(ps.map((p) => snapshotAt(p, at)?.lastHits ?? 0))
    const report = { lane, ours: o, theirs: t, soulDiff: souls(o) - souls(t), lastHitDiff: lh(o) - lh(t), at }
    lanes.push(report)
    if (Math.abs(report.soulDiff) >= 1200) {
      const tone: Tone = report.soulDiff > 0 ? 'good' : 'bad'
      push({
        tone,
        weight: 35 + Math.abs(report.soulDiff) / 300,
        title: `${report.soulDiff > 0 ? 'Won' : 'Lost'} the ${names(o, heroName)} lane by ${formatSouls(Math.abs(report.soulDiff))}`,
        detail: `vs ${names(t, heroName)} at ${mmss(at)} · last hits ${report.lastHitDiff >= 0 ? '+' : ''}${report.lastHitDiff}.`,
      })
    }
  }
  const lanesLost = lanes.filter((l) => l.soulDiff < -500).length
  if (lanes.length >= 2 && lanesLost === lanes.length) {
    push({ tone: 'bad', weight: 65, title: 'Lost every lane', detail: 'The game was decided early — behind in all lanes at the end of laning.' })
  }

  // ---- fights
  const fights = findFights(players, team)
  let lostFights = 0
  let wonFights = 0
  // Objectives already named in a fight's line don't get their own moment.
  const mentioned = new Set<(typeof detail.objectives)[number]>()
  for (const f of fights) {
    const diff = f.theirDeaths.length - f.ourDeaths.length
    const after = detail.objectives.filter((o) => o.id !== 0 && !mentioned.has(o) && o.t >= f.start && o.t <= f.end + 75)
    const lostObj = after.filter((o) => o.team === team).map((o) => OBJECTIVE_NAMES[o.id] ?? 'objective')
    const tookObj = after.filter((o) => o.team !== team).map((o) => OBJECTIVE_NAMES[o.id] ?? 'objective')
    const score = `${f.theirDeaths.length}–${f.ourDeaths.length}`
    if (Math.abs(diff) >= 2) for (const o of after) mentioned.add(o)
    if (diff <= -2) {
      lostFights++
      const wipe = f.ourDeaths.length >= ours.length - 1 ? ' (team wipe)' : ''
      moments.push({
        t: f.start,
        tone: 'bad',
        text: `Lost a fight ${score}${wipe}: ${f.ourDeaths.map((p) => heroName(p.heroId)).join(', ')} died${lostObj.length ? ` → lost ${lostObj.join(', ')}` : ''}`,
      })
    } else if (diff >= 2) {
      wonFights++
      moments.push({ t: f.start, tone: 'good', text: `Won a fight ${score}${tookObj.length ? ` → took ${tookObj.join(', ')}` : ''}` })
    } else {
      moments.push({ t: f.start, tone: 'info', text: `Even trade ${score}` })
    }
  }
  if (lostFights >= 2 && lostFights > wonFights) {
    push({ tone: 'bad', weight: 40 + lostFights * 5, title: `Lost ${lostFights} team fights, won ${wonFights}`, detail: 'Fights where your team lost at least two more heroes than the enemy. See key moments.' })
  } else if (wonFights >= 2 && wonFights > lostFights) {
    push({ tone: 'good', weight: 40 + wonFights * 5, title: `Won ${wonFights} team fights, lost ${lostFights}` })
  }

  // ---- objectives & Mid-Boss
  for (const o of detail.objectives) {
    const name = OBJECTIVE_NAMES[o.id] ?? 'objective'
    if (o.id === 0 || mentioned.has(o)) continue // core = end of game
    moments.push({ t: o.t, tone: o.team === team ? 'bad' : 'good', text: o.team === team ? `Lost a ${name}` : `Destroyed an enemy ${name}` })
  }
  const firstObj = detail.objectives.find((o) => o.id !== 0)
  if (firstObj) {
    const lostFirst = firstObj.team === team
    push({ tone: lostFirst ? 'bad' : 'good', weight: 25, title: lostFirst ? `Lost the first ${OBJECTIVE_NAMES[firstObj.id]} (${mmss(firstObj.t)})` : `Took the first objective (${mmss(firstObj.t)})` })
  }
  const objLost = detail.objectives.filter((o) => o.team === team && o.id !== 0).length
  const objTaken = detail.objectives.filter((o) => o.team !== team && o.id !== 0).length
  if (objLost - objTaken >= 3) push({ tone: 'bad', weight: 30 + (objLost - objTaken) * 3, title: `Objectives: lost ${objLost}, took ${objTaken}` })
  else if (objTaken - objLost >= 3) push({ tone: 'good', weight: 30 + (objTaken - objLost) * 3, title: `Objectives: took ${objTaken}, lost ${objLost}` })

  for (const m of detail.midBoss) {
    const ourBoss = m.teamClaimed === team
    moments.push({ t: m.t, tone: ourBoss ? 'good' : 'bad', text: ourBoss ? 'Your team claimed Mid-Boss' : 'Enemy claimed Mid-Boss' })
    push({ tone: ourBoss ? 'good' : 'bad', weight: 45, title: ourBoss ? `Claimed Mid-Boss (${mmss(m.t)})` : `Gave up Mid-Boss (${mmss(m.t)})` })
  }

  // ---- deaths & time dead
  const ourDeathsTotal = sum(ours.map((p) => p.deaths))
  const theirDeathsTotal = sum(theirs.map((p) => p.deaths))
  if (ourDeathsTotal - theirDeathsTotal >= 8) {
    const lostSouls = sum(ours.map((p) => p.souls?.lostToDeaths ?? 0))
    push({
      tone: 'bad',
      weight: 30 + (ourDeathsTotal - theirDeathsTotal),
      title: `Died ${ourDeathsTotal} times vs ${theirDeathsTotal}`,
      detail: lostSouls ? `${formatSouls(lostSouls)} souls dropped on death, plus the time spent respawning.` : undefined,
    })
  } else if (theirDeathsTotal - ourDeathsTotal >= 8) {
    push({ tone: 'good', weight: 30 + (theirDeathsTotal - ourDeathsTotal), title: `Died ${ourDeathsTotal} times vs ${theirDeathsTotal}` })
  }

  // ---- anti-heal
  const enemyHealing = sum(theirs.map((p) => (p.healing ?? 0) + (p.selfHealing ?? 0)))
  const ourDamage = sum(ours.map((p) => p.damage ?? 0))
  const ourAntiHeal = ours.flatMap((p) => finalItems(p, items).filter((i) => ANTI_HEAL_ITEMS.has(i.info.name)).map(() => p))
  if (ourDamage > 0 && enemyHealing / ourDamage >= 0.3 && ourAntiHeal.length < 2) {
    const topHealer = theirs.reduce((a, b) => ((b.healing ?? 0) + (b.selfHealing ?? 0) > (a.healing ?? 0) + (a.selfHealing ?? 0) ? b : a))
    push({
      tone: 'bad',
      weight: 30 + (enemyHealing / ourDamage) * 30,
      title: `Not enough anti-heal (${ourAntiHeal.length} on your team)`,
      detail: `Enemy healed ${formatSouls(enemyHealing)} — ${pctStr(enemyHealing / ourDamage)} of your hero damage. Biggest healer: ${heroName(topHealer.heroId)}. Healbane, Toxic Bullets, Decay or Inhibitor counter it.`,
    })
  }

  // ---- objective damage
  const ourObj = sum(ours.map((p) => p.objectiveDamage ?? 0))
  const theirObj = sum(theirs.map((p) => p.objectiveDamage ?? 0))
  if (theirObj > ourObj * 1.6 && theirObj - ourObj > 5000) {
    push({ tone: 'bad', weight: 28, title: `Enemy did ${(theirObj / Math.max(1, ourObj)).toFixed(1)}× your objective damage`, detail: `${formatSouls(theirObj)} vs ${formatSouls(ourObj)} — they converted fights into buildings, you didn't.` })
  } else if (ourObj > theirObj * 1.6 && ourObj - theirObj > 5000) {
    push({ tone: 'good', weight: 28, title: `${(ourObj / Math.max(1, theirObj)).toFixed(1)}× the enemy's objective damage` })
  }

  // ---- per-player reports
  const lobby = {
    spm: players.map((p) => p.netWorth / minutes),
    dpm: players.map((p) => (p.damage ?? 0) / minutes),
    obj: players.map((p) => p.objectiveDamage ?? 0),
    kda: players.map((p) => (p.kills + p.assists) / Math.max(1, p.deaths)),
    deaths: players.map((p) => p.deaths),
    heal: players.map((p) => p.healing ?? 0),
    eff: players.map((p) => (p.damage ?? 0) / Math.max(1, p.netWorth)),
    bigItem: players.map((p) => firstBigItemAt(p, items)).filter((t): t is number => t != null),
    acc: players.map((p) => p.accuracy).filter((a): a is number => a != null),
  }

  const reports: PlayerReport[] = players.map((p) => {
    const spm = p.netWorth / minutes
    const dpm = (p.damage ?? 0) / minutes
    const kda = (p.kills + p.assists) / Math.max(1, p.deaths)
    const eff = (p.damage ?? 0) / Math.max(1, p.netWorth)
    const timeDead = sum(p.deathDetails.map((d) => d.respawnS))
    const earlyDeaths = p.deathDetails.filter((d) => d.t <= LANE_END_S).length
    const mates = players.filter((q) => q.team === p.team)
    const laneOpp = players.filter((q) => q.team !== p.team && q.lane != null && q.lane === p.lane)
    const snap = snapshotAt(p, LANE_END_S)
    const bigItem = firstBigItemAt(p, items)

    const score =
      100 *
      avg([
        percentile(spm, lobby.spm),
        percentile(dpm, lobby.dpm),
        percentile(p.objectiveDamage ?? 0, lobby.obj),
        percentile(kda, lobby.kda),
        1 - percentile(p.deaths, lobby.deaths),
        percentile(p.healing ?? 0, lobby.heal) * 0.5 + 0.25,
      ])
    const grade = score >= 80 ? 'S' : score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D'

    const findings: Finding[] = []
    const f = (tone: Tone, weight: number, title: string, detail?: string) => findings.push({ tone, weight, title, detail })

    if (p.mvpRank === 1) f('good', 100, 'Match MVP')
    else if (p.mvpRank) f('good', 90, `Key player (#${p.mvpRank})`)
    if (p.abandonedAtS) f('bad', 100, `Left the match at ${mmss(p.abandonedAtS)}`)

    // Laning
    if (snap && laneOpp.length) {
      const oppSouls = avg(laneOpp.map((q) => snapshotAt(q, snap.t)?.netWorth ?? 0))
      const oppLh = avg(laneOpp.map((q) => snapshotAt(q, snap.t)?.lastHits ?? 0))
      const diff = snap.netWorth - oppSouls
      const vs = names(laneOpp, heroName)
      if (diff <= -800) f('bad', 60 + -diff / 100, `Behind in lane by ${formatSouls(-diff)} at ${mmss(snap.t)}`, `vs ${vs} · last hits ${snap.lastHits} vs ${Math.round(oppLh)}.`)
      else if (diff >= 800) f('good', 55 + diff / 100, `Ahead in lane by ${formatSouls(diff)} at ${mmss(snap.t)}`, `vs ${vs} · last hits ${snap.lastHits} vs ${Math.round(oppLh)}.`)
      if (snap.possibleCreeps >= 10) {
        const cs = snap.lastHits / snap.possibleCreeps
        if (cs < 0.5) f('bad', 40, `Missed most last hits in lane (${pctStr(cs)})`, `${snap.lastHits} of ${snap.possibleCreeps} troopers by ${mmss(snap.t)}. Last-hit the trooper orbs, and deny theirs.`)
        else if (cs >= 0.8) f('good', 30, `Clean last-hitting in lane (${pctStr(cs)})`)
      }
    }
    if (earlyDeaths >= 3) f('bad', 50 + earlyDeaths * 3, `Died ${earlyDeaths} times before ${mmss(LANE_END_S)}`, 'Early deaths hand your lane opponent souls and lane control.')

    // Deaths
    if (timeDead / detail.durationS >= 0.12) {
      f('bad', 45 + (timeDead / detail.durationS) * 100, `Spent ${mmss(timeDead)} dead (${pctStr(timeDead / detail.durationS)} of the game)`, p.souls?.lostToDeaths ? `${formatSouls(p.souls.lostToDeaths)} souls dropped on death.` : undefined)
    }
    const killers = new Map<number, number>()
    for (const d of p.deathDetails) if (d.killerSlot != null) killers.set(d.killerSlot, (killers.get(d.killerSlot) ?? 0) + 1)
    const [nemesisSlot, nemesisKills] = [...killers.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
    const nemesis = nemesisSlot != null ? bySlot.get(nemesisSlot) : undefined
    if (nemesis && nemesisKills >= 3) f('bad', 35 + nemesisKills * 3, `Killed by ${heroName(nemesis.heroId)} ${nemesisKills} times`, `${nemesis.name}. Respect their power spikes, or build to counter them.`)
    if (p.deaths <= 2 && detail.durationS > 900) f('good', 35, `Only ${p.deaths} death${p.deaths === 1 ? '' : 's'}`)

    // Farm
    const spmRankTeam = rankDesc(spm, mates.map((q) => q.netWorth / minutes))
    const spmRankLobby = rankDesc(spm, lobby.spm)
    if (spmRankLobby <= 2) f('good', 50, `#${spmRankLobby} souls in the lobby`, `${Math.round(spm)} souls/min.`)
    else if (spmRankTeam === mates.length && spm < avg(lobby.spm) * 0.85) f('bad', 40, 'Lowest souls on the team', `${Math.round(spm)}/min vs lobby avg ${Math.round(avg(lobby.spm))}.`)
    if (p.souls && p.netWorth > 0) {
      const jungle = p.souls.neutrals / p.netWorth
      if (jungle < 0.06 && spm < avg(lobby.spm) && detail.durationS > 900) f('bad', 30, `Barely farmed jungle camps (${pctStr(jungle)} of souls)`, 'Clear camps between waves, especially when your lane is pushed.')
    }

    // Damage
    const dpmRank = rankDesc(dpm, lobby.dpm)
    if (dpmRank <= 2) f('good', 50, `#${dpmRank} hero damage in the lobby`, `${Math.round(dpm)}/min.`)
    else if (dpm < avg(lobby.dpm) * 0.6) f('bad', 40, 'Low hero damage', `${Math.round(dpm)}/min vs lobby avg ${Math.round(avg(lobby.dpm))}.`)
    if (eff < avg(lobby.eff) * 0.65 && spm >= median(lobby.spm)) {
      f('bad', 38, 'Plenty of souls, little damage', `${eff.toFixed(2)} damage per soul vs lobby avg ${avg(lobby.eff).toFixed(2)}. Check the build or how often you're in fights.`)
    }
    const objTeam = mates.map((q) => q.objectiveDamage ?? 0)
    if ((p.objectiveDamage ?? 0) === Math.min(...objTeam) && (p.objectiveDamage ?? 0) < avg(objTeam) * 0.4 && detail.durationS > 900) {
      f('bad', 25, 'Least objective damage on the team', `${formatSouls(p.objectiveDamage ?? 0)} vs team avg ${formatSouls(avg(objTeam))}. Hit buildings after won fights.`)
    }
    const takenPerDeath = (p.damageTaken ?? 0) / Math.max(1, p.deaths)
    if ((p.damageTaken ?? 0) >= Math.max(...mates.map((q) => q.damageTaken ?? 0)) && p.deaths <= avg(mates.map((q) => q.deaths))) {
      f('good', 32, 'Frontliner', `Took the most damage on the team (${formatSouls(p.damageTaken ?? 0)}) without dying more than average.`)
    }

    // Items
    if (bigItem != null && lobby.bigItem.length >= 4) {
      const med = median(lobby.bigItem)
      if (bigItem > med + 180) f('bad', 30, `Slow first big item (${mmss(bigItem)})`, `Lobby median ${mmss(med)} for a ${BIG_ITEM_COST}+ soul item.`)
      else if (bigItem < med - 180) f('good', 25, `Fast first big item (${mmss(bigItem)})`)
    } else if (bigItem == null && detail.durationS > 1200) {
      f('bad', 30, `No ${BIG_ITEM_COST}+ soul item all game`)
    }

    findings.sort((a, b) => b.weight - a.weight)

    const tone = (good: boolean, bad: boolean): Tone => (good ? 'good' : bad ? 'bad' : 'info')
    const metrics: Metric[] = [
      { label: 'Souls/min', value: String(Math.round(spm)), compare: `avg ${Math.round(avg(lobby.spm))}`, tone: tone(spm > avg(lobby.spm) * 1.15, spm < avg(lobby.spm) * 0.85) },
      { label: 'Damage/min', value: String(Math.round(dpm)), compare: `avg ${Math.round(avg(lobby.dpm))}`, tone: tone(dpm > avg(lobby.dpm) * 1.15, dpm < avg(lobby.dpm) * 0.85) },
      { label: 'KDA', value: kda.toFixed(1), compare: `avg ${avg(lobby.kda).toFixed(1)}`, tone: tone(kda > avg(lobby.kda) * 1.2, kda < avg(lobby.kda) * 0.8) },
      { label: 'Time dead', value: mmss(timeDead), compare: pctStr(timeDead / detail.durationS), tone: tone(timeDead / detail.durationS < 0.05, timeDead / detail.durationS >= 0.12) },
      { label: 'Obj dmg', value: formatSouls(p.objectiveDamage ?? 0), compare: `avg ${formatSouls(avg(lobby.obj))}`, tone: tone((p.objectiveDamage ?? 0) > avg(lobby.obj) * 1.3, (p.objectiveDamage ?? 0) < avg(lobby.obj) * 0.5) },
      { label: 'Taken/death', value: formatSouls(takenPerDeath), tone: 'info' },
    ]
    if (snap) metrics.push({ label: `Souls @ ${mmss(snap.t)}`, value: formatSouls(snap.netWorth), compare: laneOpp.length ? `opp ${formatSouls(avg(laneOpp.map((q) => snapshotAt(q, snap.t)?.netWorth ?? 0)))}` : undefined, tone: 'info' })
    if (p.accuracy != null) metrics.push({ label: 'Accuracy', value: pctStr(p.accuracy), compare: `avg ${pctStr(avg(lobby.acc))}`, tone: 'info' })
    if (p.souls && p.netWorth > 0) metrics.push({ label: 'Jungle souls', value: pctStr(p.souls.neutrals / p.netWorth), tone: 'info' })

    return { accountId: p.accountId, name: p.name, heroId: p.heroId, team: p.team, grade, score: Math.round(score), impactRank: 0, mvpRank: p.mvpRank, metrics, findings }
  })
  const scores = reports.map((r) => r.score)
  for (const r of reports) r.impactRank = rankDesc(r.score, scores)
  reports.sort((a, b) => a.impactRank - b.impactRank)

  // Team-level: the weakest link on a losing team is worth naming.
  if (!won) {
    const worst = reports.filter((r) => r.team === team).at(-1)
    const p = worst && players.find((q) => q.accountId === worst.accountId)
    if (worst && p && worst.score < 35) {
      const top = worst.findings.find((x) => x.tone === 'bad')
      push({ tone: 'bad', weight: 20, title: `Lowest impact: ${label(p)}`, detail: top ? top.title : undefined })
    }
  }

  wentWrong.sort((a, b) => b.weight - a.weight)
  wentRight.sort((a, b) => b.weight - a.weight)
  moments.sort((a, b) => a.t - b.t)

  return { team, won, finalSoulDiff, wentWrong, wentRight, moments, lanes, players: reports }
}
