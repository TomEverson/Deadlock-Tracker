import type { ItemInfo } from '../../assets/types'
import { formatSouls } from '../../../lib/format'
import type { MatchDetailData, MatchDetailPlayer } from '../validators/match-detail'
import {
  allDeaths,
  ANTI_HEAL_LATE_S,
  avg,
  BIG_ITEM_COST,
  COSTLY_DEATH_S,
  countersFor,
  FIGHT_GAP_S,
  findFights,
  firstBigItemAt,
  firstTagged,
  isDeadAt,
  LANE_END_S,
  laneMapping,
  median,
  mmss,
  names,
  OBJECTIVE_NAMES,
  objectiveLane,
  optionsFor,
  pctStr,
  percentile,
  rankDesc,
  signedSouls,
  slotSpend,
  snapshotAt,
  SPIRIT_HEAVY,
  spiritLean,
  sum,
  laneName,
  type CounterReport,
  type CoverageRow,
  type Fight,
  type Objective,
  MAJOR_THREAT,
  MAJOR_THREAT_KILLS,
} from './match-facts'

export type { CounterItem, CounterReport, CoverageRow } from './match-facts'
import { hasObjectiveData, objectivesReport } from './objectives'
import { alliesNear, describeWhere, enemyDepth, fightPresence, jungleName, mapGeometry, posAt, presentInFight, zoneOf } from './positions'

// Rule-based match analysis. Pure: runs in the browser on the stored match
// detail (v2+), from one team's point of view. Every finding compares a
// player against the other 11 in the same lobby, so it adapts to rank and
// game length instead of using absolute "good" numbers.

export type Tone = 'good' | 'bad' | 'info'

/** Which part of the game a finding is about; the coach view groups by it. */
export type Area = 'laning' | 'farm' | 'fighting' | 'deaths' | 'items' | 'macro' | 'impact'

export interface Finding {
  tone: Tone
  title: string
  detail?: string
  /** Higher = more important; used for ordering. */
  weight: number
  area: Area
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
  /** Souls rank on their team at the end, 1–6 (pos 1 = most farmed). */
  pos: number
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
  /** Enemy threats and how your team itemized against them. */
  counters: CounterReport
}

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
  const posOf = (p: MatchDetailPlayer) => rankDesc(p.netWorth, players.filter((q) => q.team === p.team).map((q) => q.netWorth))
  const deathsAll = allDeaths(players)
  // v3 matches carry positions; older ones fall back to timing-only calls.
  const geo = mapGeometry(detail)
  // Lane order matches building order; checked against who was hitting the buildings in v3 paths.
  const laneMap = laneMapping(players)

  /** Buildings `t` lost with no deaths nearby and nothing taken back elsewhere: nobody defended or traded. */
  const freeLossesFor = (t: number) =>
    detail.objectives.flatMap((o) => {
      if (o.team !== t || o.id === 0 || o.id === 9) return []
      const fight = deathsAll.some((d) => d.t >= o.t - 45 && d.t <= o.t + 15)
      const trade =
        detail.objectives.some((x) => x.team !== t && Math.abs(x.t - o.t) <= 90) || detail.midBoss.some((m) => m.teamClaimed === t && Math.abs(m.t - o.t) <= 90)
      if (fight || trade) return []
      const ol = objectiveLane(o.id)
      return [{ o, lane: ol != null ? (laneMap?.get(ol) ?? null) : null }]
    })
  const freeLosses = freeLossesFor(team)
  const freeSet = new Set<Objective>(freeLosses.map((x) => x.o))

  const wentWrong: Finding[] = []
  const wentRight: Finding[] = []
  const moments: Moment[] = []
  let area: Area = 'macro'
  const push = (f: Omit<Finding, 'area'>) => (f.tone === 'good' ? wentRight : wentWrong).push({ ...f, area })

  // ---- soul lead over time
  area = 'macro'
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
  area = 'laning'
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
        title: `${report.soulDiff > 0 ? 'Won' : 'Lost'} ${laneName(lane)} by ${formatSouls(Math.abs(report.soulDiff))}`,
        detail: `${names(o, heroName)} vs ${names(t, heroName)} at ${mmss(at)} · last hits ${report.lastHitDiff >= 0 ? '+' : ''}${report.lastHitDiff}.`,
      })
    }
  }
  const lanesLost = lanes.filter((l) => l.soulDiff < -500).length
  if (lanes.length >= 2 && lanesLost === lanes.length) {
    push({ tone: 'bad', weight: 65, title: 'Lost every lane', detail: 'The game was decided early — behind in all lanes at the end of laning.' })
  }

  // ---- fights
  area = 'fighting'
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
  area = 'macro'
  for (const o of detail.objectives) {
    const name = OBJECTIVE_NAMES[o.id] ?? 'objective'
    if (o.id === 0 || mentioned.has(o)) continue // core = end of game
    const free = freeSet.has(o) ? ' — no fight, nothing traded' : ''
    moments.push({ t: o.t, tone: o.team === team ? 'bad' : 'good', text: o.team === team ? `Lost a ${name}${free}` : `Destroyed an enemy ${name}` })
  }
  const firstObj = detail.objectives.find((o) => o.id !== 0)
  if (firstObj) {
    const lostFirst = firstObj.team === team
    push({ tone: lostFirst ? 'bad' : 'good', weight: 25, title: lostFirst ? `Lost the first ${OBJECTIVE_NAMES[firstObj.id]} (${mmss(firstObj.t)})` : `Took the first objective (${mmss(firstObj.t)})` })
  }
  const objLost = detail.objectives.filter((o) => o.team === team && o.id !== 0).length
  const objTaken = detail.objectives.filter((o) => o.team !== team && o.id !== 0).length
  if (freeLosses.length >= 2) {
    const list = freeLosses.map(({ o, lane }) => `${OBJECTIVE_NAMES[o.id] ?? 'objective'}${lane != null ? ` (${laneName(lane)})` : ''} ${mmss(o.t)}`)
    push({
      tone: 'bad',
      weight: 32 + freeLosses.length * 4,
      title: `Gave up ${freeLosses.length} buildings without a fight`,
      detail: `${list.join(', ')}. No deaths nearby and nothing taken back elsewhere — nobody rotated to defend.`,
    })
  }
  if (objLost - objTaken >= 3) push({ tone: 'bad', weight: 30 + (objLost - objTaken) * 3, title: `Objectives: lost ${objLost}, took ${objTaken}` })
  else if (objTaken - objLost >= 3) push({ tone: 'good', weight: 30 + (objTaken - objLost) * 3, title: `Objectives: took ${objTaken}, lost ${objLost}` })

  for (const m of detail.midBoss) {
    const ourBoss = m.teamClaimed === team
    const losers = ourBoss ? theirs : ours
    const dead = losers.filter((p) => isDeadAt(p, m.t)).length
    const deadText = dead >= 2 ? (ourBoss ? `${dead} enemies were dead when you took it.` : `${dead} of your team were dead when it fell.`) : undefined
    moments.push({ t: m.t, tone: ourBoss ? 'good' : 'bad', text: `${ourBoss ? 'Your team claimed Mid-Boss' : 'Enemy claimed Mid-Boss'}${dead >= 2 ? ` (${dead} ${ourBoss ? 'enemies' : 'of yours'} dead)` : ''}` })
    push({ tone: ourBoss ? 'good' : 'bad', weight: 45, title: ourBoss ? `Claimed Mid-Boss (${mmss(m.t)})` : `Gave up Mid-Boss (${mmss(m.t)})`, detail: deadText })
  }

  // ---- deaths & time dead
  area = 'deaths'
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

  // ---- counter-items (per team, so enemy cards get the same checks)
  area = 'items'
  const countersByTeam = [0, 1].map((t) => countersFor(players, t, items, posOf, heroName))
  const counters = countersByTeam[team]!
  if (counters.tagsLoaded && counters.needs.antiHeal) {
    const onTime = counters.rows.filter((r) => r.antiHeal && r.antiHeal.t <= ANTI_HEAL_LATE_S)
    const late = counters.rows.filter((r) => r.antiHeal && r.antiHeal.t > ANTI_HEAL_LATE_S)
    const healersText = counters.healers.map((h) => `${heroName(h.heroId)} ${formatSouls(h.healing)}`).join(', ')
    const buys = (rs: CoverageRow[]) => rs.map((r) => `${heroName(r.heroId)} ${r.antiHeal!.name} ${mmss(r.antiHeal!.t)}`).join(', ')
    if (onTime.length < 2) {
      const topDamage = [...ours].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0)).slice(0, 2)
      const skipped = topDamage.filter((p) => !counters.rows.find((r) => r.accountId === p.accountId)?.antiHeal)
      push({
        tone: 'bad',
        weight: 40 + Math.min(1, counters.healShare) * 40,
        title: `Not enough anti-heal: ${onTime.length} by ${mmss(ANTI_HEAL_LATE_S)}${counters.healers.length ? ` vs ${counters.healers.length} healer${counters.healers.length === 1 ? '' : 's'}` : ''}`,
        detail: [
          `Enemy healed ${formatSouls(counters.enemyHealing)} (${pctStr(counters.healShare)} of your hero damage)${healersText ? ` — ${healersText}` : ''}.`,
          skipped.length ? `Your top damage ${skipped.length === 1 ? 'dealer' : 'dealers'} ${skipped.map(label).join(' and ')} never bought it.` : null,
          late.length ? `Late: ${buys(late)}.` : null,
        ]
          .filter(Boolean)
          .join(' '),
      })
    } else {
      push({ tone: 'good', weight: 26, title: `Anti-heal on time (${onTime.length} players by ${mmss(ANTI_HEAL_LATE_S)})`, detail: buys(onTime) })
    }
  }
  for (const kind of ['spiritResist', 'bulletResist'] as const) {
    if (!counters.tagsLoaded || !counters.needs[kind] || counters.spiritShare == null) continue
    const covered = counters.rows.filter((r) => r[kind]).length
    if (covered > 2) continue
    const spirit = kind === 'spiritResist'
    const share = spirit ? counters.spiritShare : 1 - counters.spiritShare
    push({
      tone: 'bad',
      weight: 30,
      title: `Enemy built ${pctStr(share)} ${spirit ? 'spirit' : 'weapon'}, only ${covered} of you bought ${spirit ? 'spirit' : 'bullet'} resist`,
      detail: `Estimated from enemy item spend, weighted by their damage. ${optionsFor(kind, items)}.`,
    })
  }

  // Can anyone shut down the heroes that carried the enemy?
  for (const threat of counters.threats.filter((x) => x.score >= MAJOR_THREAT && x.kills >= MAJOR_THREAT_KILLS).slice(0, 2)) {
    const hero = heroName(threat.heroId)
    const disables = threat.counters.filter((c) => c.role === 'disable')
    if (disables.length === 0) continue
    const owned = disables.filter((c) => c.buyers.length)
    if (owned.length === 0) {
      push({
        tone: 'bad',
        weight: 34 + threat.score * 40,
        title: `Nobody could shut down ${hero}`,
        detail: `${hero} had ${threat.kills} kills (${pctStr(threat.killShare)} of their team's) and ${pctStr(threat.damageShare)} of its damage. ${disables.map((c) => c.name).join(', ')} would interrupt or lock them down — nobody on your team bought one.`,
      })
    } else {
      const first = owned.flatMap((c) => c.buyers.map((b) => ({ item: c.name, ...b }))).sort((a, b) => a.t - b.t)[0]!
      push({ tone: 'good', weight: 22, title: `Had an answer to ${hero}`, detail: `${heroName(first.heroId)} bought ${first.item} at ${mmss(first.t)}.` })
    }
  }

  // ---- objective damage
  area = 'macro'
  const ourObj = sum(ours.map((p) => p.objectiveDamage ?? 0))
  const theirObj = sum(theirs.map((p) => p.objectiveDamage ?? 0))
  if (theirObj > ourObj * 1.6 && theirObj - ourObj > 5000) {
    push({ tone: 'bad', weight: 28, title: `Enemy did ${(theirObj / Math.max(1, ourObj)).toFixed(1)}× your objective damage`, detail: `${formatSouls(theirObj)} vs ${formatSouls(ourObj)} — they converted fights into buildings, you didn't.` })
  } else if (ourObj > theirObj * 1.6 && ourObj - theirObj > 5000) {
    push({ tone: 'good', weight: 28, title: `${(ourObj / Math.max(1, theirObj)).toFixed(1)}× the enemy's objective damage` })
  }

  // ---- jungle & power-ups (v5): camps and permanent buffs, team vs team
  const objectiveData = hasObjectiveData(detail)
  if (objectiveData) {
    const { ours: o, theirs: e } = objectivesReport(detail, team)
    area = 'farm'
    const campGap = e.camps - o.camps
    if (campGap >= 15 && e.camps >= o.camps * 1.35) {
      push({ tone: 'bad', weight: 30 + campGap / 2, title: `Enemy farmed ${campGap} more jungle camps (${e.camps} vs ${o.camps})`, detail: `${signedSouls(o.campSouls - e.campSouls)} souls from camps. Clear camps between waves, and invade theirs when you're ahead.` })
    } else if (-campGap >= 15 && o.camps >= e.camps * 1.35) {
      push({ tone: 'good', weight: 24 + -campGap / 3, title: `Out-farmed the jungle: ${o.camps} camps vs ${e.camps}` })
    }
    area = 'macro'
    const buffGap = e.permanentBuffs - o.permanentBuffs
    if (buffGap >= 8) {
      push({
        tone: 'bad',
        weight: 30 + buffGap,
        title: `Enemy collected ${buffGap} more permanent buffs (${e.permanentBuffs} vs ${o.permanentBuffs})`,
        detail: 'From Soul Urns, Sinner\'s Sacrifice, Haunts and crates. Contest them, or take the one on the other side of the map.',
      })
    } else if (-buffGap >= 8) {
      push({ tone: 'good', weight: 24 + -buffGap / 2, title: `Collected ${-buffGap} more permanent buffs than the enemy (${o.permanentBuffs} vs ${e.permanentBuffs})` })
    }
  }

  // ---- coaching: per-player calls on itemization and rotation
  const fightsByTeam = [0, 1].map((t) => findFights(players, t))
  const lobbyDeaths = players.map((p) => p.deaths)
  const coaching = new Map<number, Finding[]>(players.map((p) => [p.accountId, []]))
  for (const p of players) {
    const out = coaching.get(p.accountId)!
    let area: Area = 'items'
    const coach = (tone: Tone, weight: number, title: string, detail?: string) => out.push({ tone, weight, title, detail, area })
    const mates = players.filter((q) => q.team === p.team)
    const c = countersByTeam[p.team]!
    const row = c.rows.find((r) => r.accountId === p.accountId)!
    const pos = posOf(p)
    const dmgRank = rankDesc(p.damage ?? 0, mates.map((q) => q.damage ?? 0))

    // Anti-heal is the job of the team's cores and top damage dealers.
    if (c.tagsLoaded && c.needs.antiHeal && (pos <= 2 || dmgRank <= 2)) {
      const healers = c.healers.map((h) => heroName(h.heroId)).join(', ')
      const role = pos === 1 ? 'the most-farmed hero on your team' : pos === 2 ? 'the #2 farm on your team' : `#${dmgRank} damage on your team`
      if (!row.antiHeal) {
        if (p.netWorth >= 12000) {
          coach(
            'bad',
            58,
            c.healers.length >= 2 ? `No anti-heal vs ${c.healers.length} healers` : 'No anti-heal vs a high-healing enemy',
            `As ${role} this was your item. Enemy healed ${formatSouls(c.enemyHealing)} (${pctStr(c.healShare)} of your team's damage)${healers ? `, mostly ${healers}` : ''}. ${optionsFor('antiHeal', items)}.`,
          )
        }
      } else if (row.antiHeal.t > ANTI_HEAL_LATE_S) {
        coach('bad', 34, `Late anti-heal (${row.antiHeal.name} at ${mmss(row.antiHeal.t)})`, `Against ${healers || 'this much healing'}, aim to have it by ${mmss(ANTI_HEAL_LATE_S)}.`)
      } else {
        coach('good', 34, `Anti-heal on time (${row.antiHeal.name} at ${mmss(row.antiHeal.t)})`)
      }
    }

    // Resist vs the enemy's damage type, for players who kept dying.
    const deathsHigh = p.deaths >= Math.max(4, median(mates.map((q) => q.deaths)))
    if (c.tagsLoaded && deathsHigh && p.netWorth >= 15000 && c.spiritShare != null) {
      for (const kind of ['spiritResist', 'bulletResist'] as const) {
        if (!c.needs[kind] || row[kind]) continue
        const spirit = kind === 'spiritResist'
        const share = spirit ? c.spiritShare : 1 - c.spiritShare
        coach(
          'bad',
          42,
          `No ${spirit ? 'spirit' : 'bullet'} resist vs a ${spirit ? 'spirit' : 'weapon'}-heavy enemy`,
          `About ${pctStr(share)} of enemy damage came from ${spirit ? 'spirit' : 'weapon'} builds and you died ${p.deaths} times. ${optionsFor(kind, items)}.`,
        )
      }
    }

    // Souls sitting in the bank instead of in items.
    if (objectiveData && p.objectives?.unspentSoulMinutes != null) {
      const avgUnspent = p.objectives.unspentSoulMinutes / minutes
      const lobbyUnspent = median(players.flatMap((q) => (q.objectives?.unspentSoulMinutes != null ? [q.objectives.unspentSoulMinutes / minutes] : [])))
      if (avgUnspent >= 3500 && avgUnspent >= lobbyUnspent * 1.4) {
        coach(
          'bad',
          34,
          `Sat on unspent souls (${formatSouls(avgUnspent)} on average)`,
          `Lobby median ${formatSouls(lobbyUnspent)}. Souls in the bank do nothing in a fight — spend on the way back to lane.`,
        )
      }
    }

    // Glass build: nothing on vitality while dying a lot.
    const spend = slotSpend(p, items)
    const spent = spend.weapon + spend.vitality + spend.spirit
    if (spent >= 12000 && spend.vitality / spent < 0.15 && percentile(p.deaths, lobbyDeaths) >= 0.75) {
      coach(
        'bad',
        36,
        `Glass build: ${pctStr(spend.vitality / spent)} of item souls on vitality`,
        `You died ${p.deaths} times (lobby avg ${avg(lobbyDeaths).toFixed(1)}). One or two vitality items would keep you in fights longer.`,
      )
    }

    // Own lane's buildings lost with nobody defending.
    area = 'macro'
    const ownLaneLosses = freeLossesFor(p.team).filter((x) => x.lane != null && x.lane === p.lane)
    // With positions: standing in the lane when it fell = out-pushed, not a rotation problem.
    const inLaneAt = (t: number) => {
      const at = geo && !isDeadAt(p, t) ? posAt(p, t, geo) : null
      const z = at && geo ? zoneOf(at, geo) : null
      return z?.kind === 'lane' && z.lane === p.lane
    }
    const pushedOut = ownLaneLosses.filter(({ o }) => inLaneAt(o.t))
    const undefended = ownLaneLosses.filter(({ o }) => !inLaneAt(o.t))
    if (pushedOut.length) {
      const first = pushedOut[0]!.o
      coach(
        'bad',
        34 + pushedOut.length * 4,
        pushedOut.length === 1
          ? `Lost your lane's ${OBJECTIVE_NAMES[first.id] ?? 'building'} while you were in lane (${mmss(first.t)})`
          : `Lost ${pushedOut.length} lane buildings while you were in lane`,
        `${pushedOut.map(({ o }) => `${OBJECTIVE_NAMES[o.id] ?? 'objective'} ${mmss(o.t)}`).join(', ')}, with no deaths on either side: the enemy out-pushed you. Clear waves before they reach your building, and call for help if the lane is lost.`,
      )
    }
    if (undefended.length) {
      const list = undefended.map(({ o }) => {
        const where = geo ? describeWhere(p, o.t, geo) : isDeadAt(p, o.t) ? 'dead' : null
        return `${OBJECTIVE_NAMES[o.id] ?? 'objective'} ${mmss(o.t)}${where ? ` (you were ${where})` : ''}`
      })
      const first = undefended[0]!.o
      coach(
        'bad',
        36 + undefended.length * 4,
        undefended.length === 1 ? `Your lane's ${OBJECTIVE_NAMES[first.id] ?? 'building'} fell undefended (${mmss(first.t)})` : `${undefended.length} of your lane's buildings fell undefended`,
        `${list.join(', ')}. No fight nearby and nothing traded elsewhere. Rotate back to defend, or take a building somewhere else in exchange.`,
      )
    }

    // Deaths after laning that handed over an objective.
    const costly = p.deathDetails
      .filter((d) => d.t > LANE_END_S)
      .flatMap((d) => {
        const obj = detail.objectives.find((o) => o.team === p.team && o.id !== 0 && o.t > d.t && o.t <= d.t + COSTLY_DEATH_S)
        const boss = detail.midBoss.find((m) => m.teamClaimed !== p.team && m.t > d.t && m.t <= d.t + COSTLY_DEATH_S)
        const what = obj ? (OBJECTIVE_NAMES[obj.id] ?? 'objective') : boss ? 'Mid-Boss' : null
        return what ? [`${mmss(d.t)} → ${what}`] : []
      })
    if (costly.length >= 2) coach('bad', 34 + costly.length * 4, `${costly.length} deaths led straight to a lost objective`, `${costly.join(', ')}, each within a minute.`)

    // Team fights after laning: were they there? With paths, "there" means
    // near the fight; without, only a kill or a death proves it.
    area = 'fighting'
    const involved = (f: Fight) => presentInFight(p, f, geo)
    const couldJoin = (f: Fight) => !isDeadAt(p, f.start - 1) || f.deaths.some((d) => d.p === p)
    // Real fights only (4+ deaths, or a clear 2+ winner) — 2-for-1 skirmishes don't need everyone.
    const fights = fightsByTeam[p.team]!.filter(
      (f) => f.start > LANE_END_S && (f.deaths.length >= 4 || Math.abs(f.ourDeaths.length - f.theirDeaths.length) >= 2) && couldJoin(f),
    )
    const lost = fights.filter((f) => f.ourDeaths.length - f.theirDeaths.length >= 2)
    const missed = fights.filter((f) => !involved(f))
    const missedLost = missed.filter((f) => lost.includes(f)).length
    if (fights.length >= 3 && missed.length >= 2 && missed.length / fights.length >= 0.5) {
      const list = missed.map((f) => {
        const late = fightPresence(p, f, geo) === 'late'
        const where = geo ? describeWhere(p, f.start, geo) : null
        return `${mmss(f.start)}${late ? ` (arrived late${where ? `, was ${where}` : ''})` : where ? ` (${where})` : ''}`
      })
      coach(
        'bad',
        36 + missed.length * 3 + missedLost * 2,
        geo ? `Missed ${missed.length} of ${fights.length} team fights` : `No kill or death in ${missed.length} of ${fights.length} team fights`,
        `${list.join(', ')}${missedLost ? `. ${missedLost} of them were lost` : ''}. ${
          geo ? 'You weren\'t there when they started.' : 'Likely farming or in another lane while your team fought.'
        } Group up before objectives, or make the split push take a building.`,
      )
    } else if (fights.length >= 3 && missed.length === 0) {
      coach('good', 28, `Involved in every team fight (${fights.length})`)
    }

    // Opening fights a man down: first to die in fights the team lost.
    const openedLost = lost.filter((f) => f.deaths[0]?.p === p)
    if (openedLost.length >= 2) {
      coach(
        'bad',
        38 + openedLost.length * 4,
        `Died first in ${openedLost.length} of ${lost.length} lost team fights`,
        `${openedLost.map((f) => mmss(f.start)).join(', ')}. Your team fought a hero down each time — hang back until the fight starts, or wait for your team before stepping up.`,
      )
    }

    // Picked off: hero kills with no other death around them (and, with
    // positions, no teammate nearby). Deep in enemy territory = overextended.
    area = 'deaths'
    const solo = p.deathDetails.filter((d) => {
      if (d.t <= LANE_END_S || d.killerSlot == null || deathsAll.some((x) => x.p !== p && Math.abs(x.t - d.t) <= FIGHT_GAP_S)) return false
      return !(geo && d.pos) || alliesNear(p, players, d.pos, d.t, geo) === 0
    })
    if (solo.length >= 3) {
      const deep = geo ? solo.filter((d) => d.pos && enemyDepth(d.pos, p.team, geo) > 0.15).length : 0
      coach(
        'bad',
        33 + solo.length * 3 + deep * 2,
        `Picked off alone ${solo.length} times`,
        `${solo.map((d) => mmss(d.t)).join(', ')}${deep ? `, ${deep} of them deep in enemy territory` : ''}. ${
          deep >= 2 ? "Don't push past the midline without a teammate or vision of the enemy." : "Move with a teammate when you don't know where the enemy is."
        }`,
      )
    }

    // Laning discipline: time actually spent in your own lane, and whether leaving it paid off.
    area = 'laning'
    if (geo && p.lane != null && p.path) {
      let inLane = 0
      let samples = 0
      const elsewhere = new Map<string, number>()
      for (let t = 60; t <= Math.min(LANE_END_S, detail.durationS); t += geo.stepS) {
        if (isDeadAt(p, t)) continue
        const at = posAt(p, t, geo)
        if (!at) continue
        samples++
        const z = zoneOf(at, geo)
        if (z.kind === 'lane' && z.lane === p.lane) inLane++
        else {
          const key = z.kind === 'lane' ? laneName(z.lane) : z.kind === 'jungle' ? jungleName(z) : z.team === p.team ? 'your base' : 'the enemy base'
          elsewhere.set(key, (elsewhere.get(key) ?? 0) + 1)
        }
      }
      const rotationKills = players
        .filter((q) => q.team !== p.team)
        .flatMap((q) => q.deathDetails.filter((d) => d.t <= LANE_END_S && p.slot != null && d.killerSlot === p.slot && d.pos))
        .filter((d) => {
          const z = zoneOf(d.pos!, geo)
          return z.kind === 'lane' && z.lane !== p.lane
        }).length
      const share = samples ? inLane / samples : 1
      if (rotationKills >= 2) {
        coach('good', 34, `Rotated for ${rotationKills} kills in other lanes during laning`)
      } else if (samples >= 30 && share < 0.6) {
        const top = [...elsewhere.entries()].sort((a, b) => b[1] - a[1])[0]
        coach(
          'bad',
          40 + (0.6 - share) * 40,
          `Left your lane too often during laning (${pctStr(share)} of the time in lane)`,
          `${top ? `Mostly in ${top[0]}. ` : ''}Roaming without kills costs you lane farm and leaves your partner alone.`,
        )
      }
    }
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
    cs: players.flatMap((p) => {
      const s = snapshotAt(p, LANE_END_S)
      return s && s.possibleCreeps >= 10 ? [s.lastHits / s.possibleCreeps] : []
    }),
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
    let area: Area = 'impact'
    const f = (tone: Tone, weight: number, title: string, detail?: string) => findings.push({ tone, weight, title, detail, area })

    if (p.mvpRank === 1) f('good', 100, 'Match MVP')
    else if (p.mvpRank) f('good', 90, `Key player (#${p.mvpRank})`)
    if (p.abandonedAtS) f('bad', 100, `Left the match at ${mmss(p.abandonedAtS)}`)

    // Laning
    area = 'laning'
    if (snap && laneOpp.length) {
      const oppSouls = avg(laneOpp.map((q) => snapshotAt(q, snap.t)?.netWorth ?? 0))
      const oppLh = avg(laneOpp.map((q) => snapshotAt(q, snap.t)?.lastHits ?? 0))
      const diff = snap.netWorth - oppSouls
      const vs = names(laneOpp, heroName)
      const laneTxt = p.lane != null ? laneName(p.lane) : 'lane'
      if (diff <= -800) f('bad', 60 + -diff / 100, `Behind in ${laneTxt} by ${formatSouls(-diff)} at ${mmss(snap.t)}`, `vs ${vs} · last hits ${snap.lastHits} vs ${Math.round(oppLh)}.`)
      else if (diff >= 800) f('good', 55 + diff / 100, `Ahead in ${laneTxt} by ${formatSouls(diff)} at ${mmss(snap.t)}`, `vs ${vs} · last hits ${snap.lastHits} vs ${Math.round(oppLh)}.`)
      if (snap.possibleCreeps >= 10 && lobby.cs.length >= 6) {
        // Relative to the lobby: typical rates vary a lot with rank and patch.
        const cs = snap.lastHits / snap.possibleCreeps
        const med = median(lobby.cs)
        if (cs < med * 0.7) f('bad', 40, `Poor last-hitting in lane (${pctStr(cs)})`, `${snap.lastHits} of ${snap.possibleCreeps} troopers by ${mmss(snap.t)}; lobby median ${pctStr(med)}. Last-hit the trooper orbs, and deny theirs.`)
      }
    }
    if (earlyDeaths >= 3) f('bad', 50 + earlyDeaths * 3, `Died ${earlyDeaths} times before ${mmss(LANE_END_S)}`, 'Early deaths hand your lane opponent souls and lane control.')

    // Deaths
    area = 'deaths'
    if (timeDead / detail.durationS >= 0.12) {
      f('bad', 45 + (timeDead / detail.durationS) * 100, `Spent ${mmss(timeDead)} dead (${pctStr(timeDead / detail.durationS)} of the game)`, p.souls?.lostToDeaths ? `${formatSouls(p.souls.lostToDeaths)} souls dropped on death.` : undefined)
    }
    const killers = new Map<number, number>()
    for (const d of p.deathDetails) if (d.killerSlot != null) killers.set(d.killerSlot, (killers.get(d.killerSlot) ?? 0) + 1)
    const [nemesisSlot, nemesisKills] = [...killers.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
    const nemesis = nemesisSlot != null ? bySlot.get(nemesisSlot) : undefined
    if (nemesis && nemesisKills >= 3) {
      // Hero-specific protection first (they kept killing *you*, so it's your item), then damage type.
      const threat = countersByTeam[p.team]!.threats.find((x) => x.accountId === nemesis.accountId)
      const protect = threat?.counters.filter((c) => c.role === 'protect') ?? []
      const owned = protect.filter((c) => c.buyers.some((b) => b.accountId === p.accountId))
      const lean = spiritLean(nemesis, items)
      const kind = lean == null ? null : lean >= SPIRIT_HEAVY ? 'spiritResist' : lean <= 1 - SPIRIT_HEAVY ? 'bulletResist' : null
      const word = kind === 'spiritResist' ? 'spirit' : 'bullet'
      const tip = owned.length
        ? `You had ${owned.map((c) => c.name).join(' and ')} — play around their cooldowns and power spikes.`
        : protect.length
          ? `You had none of the items that protect against ${heroName(nemesis.heroId)}: ${protect.map((c) => c.name).join(', ')}.`
          : !kind
            ? 'Respect their power spikes, or build to counter them.'
            : firstTagged(p, kind, items)
              ? `They built ${kind === 'spiritResist' ? 'spirit' : 'weapon'} and you had ${word} resist — play around their cooldowns and spikes.`
              : `They built ${kind === 'spiritResist' ? 'spirit' : 'weapon'} and you had no ${word} resist: ${optionsFor(kind, items)}.`
      f(owned.length ? 'info' : 'bad', 35 + nemesisKills * 3, `Killed by ${heroName(nemesis.heroId)} ${nemesisKills} times`, `${nemesis.name}. ${tip}`)
    }
    if (p.deaths <= 2 && detail.durationS > 900) f('good', 35, `Only ${p.deaths} death${p.deaths === 1 ? '' : 's'}`)

    // Farm
    area = 'farm'
    const spmRankTeam = rankDesc(spm, mates.map((q) => q.netWorth / minutes))
    const spmRankLobby = rankDesc(spm, lobby.spm)
    if (spmRankLobby <= 2) f('good', 50, `#${spmRankLobby} souls in the lobby`, `${Math.round(spm)} souls/min.`)
    else if (spmRankTeam === mates.length && spm < avg(lobby.spm) * 0.85) f('bad', 40, 'Lowest souls on the team', `${Math.round(spm)}/min vs lobby avg ${Math.round(avg(lobby.spm))}.`)
    if (p.souls && p.netWorth > 0) {
      const jungle = p.souls.neutrals / p.netWorth
      if (jungle < 0.06 && spm < avg(lobby.spm) && detail.durationS > 900) f('bad', 30, `Barely farmed jungle camps (${pctStr(jungle)} of souls)`, 'Clear camps between waves, especially when your lane is pushed.')
    }

    // Damage
    area = 'fighting'
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
    area = 'items'
    if (bigItem != null && lobby.bigItem.length >= 4) {
      const med = median(lobby.bigItem)
      if (bigItem > med + 180) f('bad', 30, `Slow first big item (${mmss(bigItem)})`, `Lobby median ${mmss(med)} for a ${BIG_ITEM_COST}+ soul item.`)
      else if (bigItem < med - 180) f('good', 25, `Fast first big item (${mmss(bigItem)})`)
    } else if (bigItem == null && detail.durationS > 1200) {
      f('bad', 30, `No ${BIG_ITEM_COST}+ soul item all game`)
    }

    findings.push(...(coaching.get(p.accountId) ?? []))
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
    const teamKills = sum(mates.map((q) => q.kills))
    if (teamKills > 0) {
      const kp = (p.kills + p.assists) / teamKills
      metrics.push({ label: 'Kill part.', value: pctStr(kp), compare: `of ${teamKills} team kills`, tone: tone(kp >= 0.7, kp < 0.4) })
    }
    const sp = slotSpend(p, items)
    const spTotal = sp.weapon + sp.vitality + sp.spirit
    if (spTotal > 0) {
      const pc = (x: number) => Math.round((x / spTotal) * 100)
      metrics.push({ label: 'Item split', value: `${pc(sp.weapon)}/${pc(sp.spirit)}/${pc(sp.vitality)}`, compare: 'weapon/spirit/vit', tone: 'info' })
    }

    return { accountId: p.accountId, name: p.name, heroId: p.heroId, team: p.team, grade, score: Math.round(score), impactRank: 0, pos: posOf(p), mvpRank: p.mvpRank, metrics, findings }
  })
  const scores = reports.map((r) => r.score)
  for (const r of reports) r.impactRank = rankDesc(r.score, scores)
  reports.sort((a, b) => a.impactRank - b.impactRank)

  // Team-level: the weakest link on a losing team is worth naming.
  area = 'impact'
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

  return { team, won, finalSoulDiff, wentWrong, wentRight, moments, lanes, players: reports, counters }
}
