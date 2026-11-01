import { z } from 'zod'
import { MATCH_DETAIL_VERSION, type MatchDetailData } from '../validators/match-detail'

// Pure (no Worker / network imports) so the Node CLI can use it too.
//
// The subset of CMsgMatchMetaDataContents.MatchInfo we keep, as decoded from
// Valve's replay-server metadata file by cli/lib/match-metadata.ts (protobuf
// toObject with keepCase, so field names match the .proto). Optional proto
// fields may be absent, hence the nullish/defaults.

const metaItem = z.object({
  game_time_s: z.number(),
  item_id: z.number(),
  sold_time_s: z.number().nullish(),
})

const n = z.number().nullish()

const metaStat = z.object({
  time_stamp_s: z.number(),
  net_worth: z.number().nullish(),
  gold_player: n,
  gold_player_orbs: n,
  gold_lane_creep_orbs: n,
  gold_neutral_creep_orbs: n,
  gold_boss: n,
  gold_boss_orb: n,
  gold_treasure: n,
  gold_death_loss: n,
  gold_lane_creep: n,
  gold_neutral_creep: n,
  kills: n,
  deaths: n,
  assists: n,
  creep_kills: n,
  neutral_kills: n,
  possible_creeps: n,
  denies: n,
  self_healing: n,
  damage_mitigated: n,
  level: n,
  gold_sources: z.array(z.object({ source: n, kills: n, gold: n, gold_orbs: n })).default([]),
  custom_user_stats: z.array(z.object({ value: n, id: n })).default([]),
  player_damage: z.number().nullish(),
  player_healing: z.number().nullish(),
  player_damage_taken: z.number().nullish(),
  boss_damage: z.number().nullish(),
  shots_hit: z.number().nullish(),
  shots_missed: z.number().nullish(),
  hero_bullets_hit_crit: z.number().nullish(),
  hero_bullets_hit: z.number().nullish(),
})

const metaPos = z.object({ x: n, y: n }).nullish()

const metaDeath = z.object({
  game_time_s: z.number(),
  killer_player_slot: n,
  death_duration_s: n,
  death_pos: metaPos,
  killer_pos: metaPos,
})

const metaPath = z.object({
  player_slot: n,
  x_min: n,
  y_min: n,
  x_max: n,
  y_max: n,
  x_pos: z.array(z.number()).default([]),
  y_pos: z.array(z.number()).default([]),
  health: z.array(z.number()).default([]),
  combat_type: z.array(z.number()).default([]),
})

const metaPlayer = z.object({
  account_id: z.number(),
  player_slot: n,
  assigned_lane: n,
  mvp_rank: n,
  death_details: z.array(metaDeath).default([]),
  team: z.number(),
  hero_id: z.number(),
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
  net_worth: z.number(),
  last_hits: z.number(),
  denies: z.number(),
  level: z.number(),
  abandon_match_time_s: z.number().nullish(),
  items: z.array(metaItem).default([]),
  stats: z.array(metaStat).default([]),
  power_up_buffs: z
    .array(z.object({ type: z.string().nullish(), value: n, is_permanent: z.boolean().nullish(), pickup_times_s: z.array(z.number()).default([]) }))
    .default([]),
})

export const matchMetadataSchema = z.object({
  match_id: z.coerce.number(),
  start_time: z.number(),
  duration_s: z.number(),
  winning_team: z.number(),
  game_mode: z.number(),
  match_mode: z.number(),
  average_badge_team0: z.number().nullish(),
  average_badge_team1: z.number().nullish(),
  players: z.array(metaPlayer),
  objectives: z.array(z.object({ destroyed_time_s: n, team_objective_id: n, team: n })).default([]),
  mid_boss: z.array(z.object({ team_claimed: n, destroyed_time_s: n })).default([]),
  custom_user_stats: z.array(z.object({ name: z.string().nullish(), id: n })).default([]),
  match_paths: z
    .object({ interval_s: n, x_resolution: n, y_resolution: n, paths: z.array(metaPath).default([]) })
    .nullish(),
})
export type MatchMetadata = z.infer<typeof matchMetadataSchema>

export interface PlayerProfile {
  name: string | null
  avatar: string | null
}

/** Stored positions are map units / COORD_SCALE, rounded: ~10-unit precision is plenty and keeps rows small. */
export const COORD_SCALE = 10
/** Path samples are kept every PATH_STEP_S seconds (Valve records every second). */
export const PATH_STEP_S = 5

type MetaPath = z.infer<typeof metaPath>

function scalePos(p: { x?: number | null; y?: number | null } | null | undefined): [number, number] | null {
  if (p?.x == null || p.y == null) return null
  return [Math.round(p.x / COORD_SCALE), Math.round(p.y / COORD_SCALE)]
}

// Within each kept window: the hero-fighting flag wins over pushing (enemy
// NPCs) over jungling (neutrals), so a short fight isn't lost to sampling.
const COMBAT_RANK = [0, 3, 2, 1] // indexed by ECombatType: out, hero, enemy NPC, neutral

/** Keep every n-th of Valve's samples to get about PATH_STEP_S seconds apart. */
const sampleEvery = (intervalS: number | null | undefined) => Math.max(1, Math.round(PATH_STEP_S / (intervalS || 1)))

function trimPath(path: MetaPath, xRes: number, yRes: number, intervalS: number) {
  const step = sampleEvery(intervalS)
  const toWorld = (q: number, min: number | null | undefined, max: number | null | undefined, res: number) =>
    Math.round(((min ?? 0) + (q / (res || 1)) * ((max ?? 0) - (min ?? 0))) / COORD_SCALE)
  const out = { x: [] as number[], y: [] as number[], hp: [] as number[], combat: [] as number[] }
  for (let i = 0; i < path.x_pos.length; i += step) {
    out.x.push(toWorld(path.x_pos[i]!, path.x_min, path.x_max, xRes))
    out.y.push(toWorld(path.y_pos[i] ?? 0, path.y_min, path.y_max, yRes))
    let hp = 100
    let combat = 0
    for (let j = i; j < Math.min(i + step, path.x_pos.length); j++) {
      hp = Math.min(hp, path.health[j] ?? 100)
      const c = path.combat_type[j] ?? 0
      if ((COMBAT_RANK[c] ?? 0) > (COMBAT_RANK[combat] ?? 0)) combat = c
    }
    out.hp.push(hp)
    out.combat.push(combat)
  }
  return out
}

const GOLD_SOURCE = { neutrals: 3, teamBonus: 8, breakables: 12 } as const

/** Objective-side stats from the last snapshot (camps, power-ups, bounty and comeback souls, unspent souls). */
function objectiveStats(p: MetaPlayer, statNames: Map<number, string>) {
  const last = p.stats.at(-1)
  if (!last) return null
  const source = (id: number) => last.gold_sources.find((g) => g.source === id)
  const custom = (name: string) => {
    const s = last.custom_user_stats.find((c) => statNames.get(c.id ?? -1) === name)
    return s?.value ?? null
  }
  const gold = (id: number) => (source(id)?.gold ?? 0) + (source(id)?.gold_orbs ?? 0)
  return {
    camps: source(GOLD_SOURCE.neutrals)?.kills ?? last.neutral_kills ?? 0,
    breakableSouls: gold(GOLD_SOURCE.breakables),
    bountySouls: gold(GOLD_SOURCE.teamBonus),
    comebackSouls: custom('Comeback Gold'),
    unspentSoulMinutes: custom('Unspent Gold Minutes'),
    // Temporary power-ups come without pickup times; `value` is how many.
    powerUps: p.power_up_buffs.flatMap((b) => {
      const count = b.pickup_times_s.length || (b.value ?? 0)
      return b.type && count ? [{ type: b.type, permanent: !!b.is_permanent, count, times: b.pickup_times_s }] : []
    }),
  }
}

type MetaPlayer = z.infer<typeof metaPlayer>

function ratio(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || !whole) return null
  return part / whole
}

/** Shrink the ~1MB metadata to the ~10KB stored in match_detail.data. */
export function trimMetadata(meta: MatchMetadata, profiles: Map<number, PlayerProfile>): MatchDetailData {
  // Timeline: sum each team's net worth at every stats snapshot.
  const timeline = new Map<number, { team0: number; team1: number }>()
  for (const p of meta.players) {
    for (const s of p.stats) {
      const point = timeline.get(s.time_stamp_s) ?? { team0: 0, team1: 0 }
      if (p.team === 0) point.team0 += s.net_worth ?? 0
      else point.team1 += s.net_worth ?? 0
      timeline.set(s.time_stamp_s, point)
    }
  }

  const statNames = new Map(meta.custom_user_stats.flatMap((c) => (c.name && c.id != null ? [[c.id, c.name] as const] : [])))
  const paths = meta.match_paths
  const pathBySlot = new Map((paths?.paths ?? []).map((p) => [p.player_slot ?? -1, p]))

  return {
    v: MATCH_DETAIL_VERSION,
    pathStepS: paths?.paths.length ? sampleEvery(paths.interval_s) * (paths.interval_s || 1) : null,
    matchId: meta.match_id,
    startTime: meta.start_time,
    durationS: meta.duration_s,
    winningTeam: meta.winning_team,
    gameMode: meta.game_mode,
    matchMode: meta.match_mode,
    avgBadge: [meta.average_badge_team0 || null, meta.average_badge_team1 || null],
    objectives: meta.objectives
      .filter((o) => (o.destroyed_time_s ?? 0) > 0)
      .map((o) => ({ team: o.team ?? 0, id: o.team_objective_id ?? 0, t: o.destroyed_time_s ?? 0 }))
      .sort((a, b) => a.t - b.t),
    midBoss: meta.mid_boss.map((m) => ({ teamClaimed: m.team_claimed ?? 0, t: m.destroyed_time_s ?? 0 })).sort((a, b) => a.t - b.t),
    players: meta.players.map((p) => {
      const last = p.stats.at(-1)
      const v = (x: number | null | undefined) => x ?? 0
      const profile = profiles.get(p.account_id)
      return {
        accountId: p.account_id,
        name: profile?.name ?? `Player ${p.account_id}`,
        avatar: profile?.avatar ?? null,
        team: p.team,
        heroId: p.hero_id,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        netWorth: p.net_worth,
        lastHits: p.last_hits,
        denies: p.denies,
        level: p.level,
        abandonedAtS: p.abandon_match_time_s || null,
        damage: last?.player_damage ?? null,
        healing: last?.player_healing ?? null,
        damageTaken: last?.player_damage_taken ?? null,
        objectiveDamage: last?.boss_damage ?? null,
        accuracy: ratio(last?.shots_hit, (last?.shots_hit ?? 0) + (last?.shots_missed ?? 0)),
        critRate: ratio(last?.hero_bullets_hit_crit, last?.hero_bullets_hit),
        items: p.items.map((i) => ({ itemId: i.item_id, t: i.game_time_s, soldAt: i.sold_time_s || null })),
        slot: p.player_slot ?? null,
        lane: p.assigned_lane || null,
        mvpRank: p.mvp_rank || null,
        selfHealing: last?.self_healing ?? null,
        damageMitigated: last?.damage_mitigated ?? null,
        // Slot 0 = no hero got the kill (troopers, objectives, falling…).
        deathDetails: p.death_details.map((d) => ({
          t: d.game_time_s,
          killerSlot: d.killer_player_slot || null,
          respawnS: v(d.death_duration_s),
          pos: scalePos(d.death_pos),
          killerPos: scalePos(d.killer_pos),
        })),
        objectives: objectiveStats(p, statNames),
        path: (() => {
          const path = pathBySlot.get(p.player_slot ?? -2)
          return path && paths ? trimPath(path, paths.x_resolution ?? 16383, paths.y_resolution ?? 16383, paths.interval_s ?? 1) : null
        })(),
        snapshots: p.stats.map((s) => ({
          t: s.time_stamp_s,
          netWorth: v(s.net_worth),
          kills: v(s.kills),
          deaths: v(s.deaths),
          assists: v(s.assists),
          damage: v(s.player_damage),
          damageTaken: v(s.player_damage_taken),
          lastHits: v(s.creep_kills),
          possibleCreeps: v(s.possible_creeps),
          denies: v(s.denies),
          level: v(s.level),
          heroSouls: v(s.gold_player) + v(s.gold_player_orbs),
          soulsLost: v(s.gold_death_loss),
        })),
        souls: last
          ? {
              heroes: v(last.gold_player) + v(last.gold_player_orbs),
              laneCreeps: v(last.gold_lane_creep) + v(last.gold_lane_creep_orbs),
              neutrals: v(last.gold_neutral_creep) + v(last.gold_neutral_creep_orbs),
              bosses: v(last.gold_boss) + v(last.gold_boss_orb),
              treasure: v(last.gold_treasure),
              lostToDeaths: v(last.gold_death_loss),
            }
          : null,
      }
    }),
    netWorthTimeline: [...timeline.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, ...v })),
  }
}
