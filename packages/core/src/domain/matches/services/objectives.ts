import type { MatchDetailData, MatchDetailPlayer } from '../validators/match-detail'

// Team-vs-team objective stats for one match (v5+ details). Pure.
// Valve doesn't record Soul Urn deliveries, Sinner's Sacrifice hits or
// Unstable Rift captures by name, so those show up where their rewards land:
// buffs in power-ups, payouts in objective bounty / treasure souls.

export interface ObjectiveTotals {
  camps: number
  campSouls: number
  permanentBuffs: number
  tempBuffs: number
  /** Permanent buffs by stat ("Health" → 7). */
  buffsByStat: Record<string, number>
  treasureSouls: number
  breakableSouls: number
  bountySouls: number
  bossSouls: number
  comebackSouls: number
  midBoss: number
  /** Enemy buildings destroyed (Guardians, Walkers, Shrines, Patron…). */
  buildings: number
}

export interface ObjectivePlayer {
  accountId: number
  heroId: number
  name: string
  team: number
  camps: number
  campSouls: number
  permanentBuffs: number
  tempBuffs: number
  treasureSouls: number
  breakableSouls: number
  bountySouls: number
  /** Average souls sitting unspent over the game. */
  avgUnspent: number | null
}

export interface ObjectivesReport {
  ours: ObjectiveTotals
  theirs: ObjectiveTotals
  players: ObjectivePlayer[]
}

const BUFF_STATS: Record<string, string> = {
  hp: 'Health',
  spirit: 'Spirit power',
  wp: 'Weapon power',
  firerate: 'Fire rate',
  ammo: 'Ammo',
  cd: 'Cooldowns',
  bulletresist: 'Bullet resist',
  spiritresist: 'Spirit resist',
  range: 'Range',
  movespeed: 'Move speed',
}

/** "hp_permanent_pickup_lv3" → "Health". */
export function buffStat(type: string): string {
  const key = type.split('_')[0] ?? type
  return BUFF_STATS[key] ?? key
}

export function hasObjectiveData(detail: MatchDetailData): boolean {
  return detail.players.some((p) => p.objectives != null)
}

function playerRow(p: MatchDetailPlayer, minutes: number): ObjectivePlayer {
  const o = p.objectives
  const count = (permanent: boolean) => (o?.powerUps ?? []).filter((b) => b.permanent === permanent).reduce((a, b) => a + b.count, 0)
  return {
    accountId: p.accountId,
    heroId: p.heroId,
    name: p.name,
    team: p.team,
    camps: o?.camps ?? 0,
    campSouls: p.souls?.neutrals ?? 0,
    permanentBuffs: count(true),
    tempBuffs: count(false),
    treasureSouls: p.souls?.treasure ?? 0,
    breakableSouls: o?.breakableSouls ?? 0,
    bountySouls: o?.bountySouls ?? 0,
    avgUnspent: o?.unspentSoulMinutes != null ? Math.round(o.unspentSoulMinutes / minutes) : null,
  }
}

export function objectivesReport(detail: MatchDetailData, team: number): ObjectivesReport {
  const minutes = Math.max(1, detail.durationS / 60)
  const players = detail.players.map((p) => playerRow(p, minutes))
  const totals = (t: number): ObjectiveTotals => {
    const ps = detail.players.filter((p) => p.team === t)
    const rows = players.filter((r) => r.team === t)
    const sum = (f: (r: ObjectivePlayer) => number) => rows.reduce((a, r) => a + f(r), 0)
    const buffsByStat: Record<string, number> = {}
    for (const p of ps) for (const b of p.objectives?.powerUps ?? []) if (b.permanent) buffsByStat[buffStat(b.type)] = (buffsByStat[buffStat(b.type)] ?? 0) + b.count
    return {
      camps: sum((r) => r.camps),
      campSouls: sum((r) => r.campSouls),
      permanentBuffs: sum((r) => r.permanentBuffs),
      tempBuffs: sum((r) => r.tempBuffs),
      buffsByStat,
      treasureSouls: sum((r) => r.treasureSouls),
      breakableSouls: sum((r) => r.breakableSouls),
      bountySouls: sum((r) => r.bountySouls),
      bossSouls: ps.reduce((a, p) => a + (p.souls?.bosses ?? 0), 0),
      comebackSouls: ps.reduce((a, p) => a + (p.objectives?.comebackSouls ?? 0), 0),
      midBoss: detail.midBoss.filter((m) => m.teamClaimed === t).length,
      // objectives[].team is the owner, so buildings t destroyed are owned by the other team.
      buildings: detail.objectives.filter((o) => o.team !== t && o.id !== 0).length,
    }
  }
  return { ours: totals(team), theirs: totals(1 - team), players }
}
