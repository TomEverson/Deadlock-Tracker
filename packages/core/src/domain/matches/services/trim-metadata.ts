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
  possible_creeps: n,
  denies: n,
  self_healing: n,
  damage_mitigated: n,
  level: n,
  player_damage: z.number().nullish(),
  player_healing: z.number().nullish(),
  player_damage_taken: z.number().nullish(),
  boss_damage: z.number().nullish(),
  shots_hit: z.number().nullish(),
  shots_missed: z.number().nullish(),
  hero_bullets_hit_crit: z.number().nullish(),
  hero_bullets_hit: z.number().nullish(),
})

const metaDeath = z.object({
  game_time_s: z.number(),
  killer_player_slot: n,
  death_duration_s: n,
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
})
export type MatchMetadata = z.infer<typeof matchMetadataSchema>

export interface PlayerProfile {
  name: string | null
  avatar: string | null
}

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

  return {
    v: MATCH_DETAIL_VERSION,
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
        deathDetails: p.death_details.map((d) => ({ t: d.game_time_s, killerSlot: d.killer_player_slot || null, respawnS: v(d.death_duration_s) })),
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
