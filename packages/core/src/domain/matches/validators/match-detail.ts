import { z } from 'zod'

// Shape of the trimmed JSON stored in match_detail.data. Parsed with zod on
// read. Bumping MATCH_DETAIL_VERSION makes the next sync re-download
// older rows (cli/lib/match-details.ts); until then they still render, with
// fields added since shown as missing.
//   v1: initial   v2: + per-player deaths, snapshots, lanes, soul sources; objectives, Mid-Boss (analysis)
export const MATCH_DETAIL_VERSION = 2

const storedItem = z.object({
  itemId: z.number(),
  t: z.number(), // game time purchased, seconds
  soldAt: z.number().nullable(),
})

const storedDeath = z.object({
  t: z.number(), // game time, seconds
  killerSlot: z.number().nullable(), // null = not killed by a hero (troopers, objectives…)
  respawnS: z.number(),
})

// Per-player stats every 3 min until 15:00, then every 5 min, plus the end.
const storedSnapshot = z.object({
  t: z.number(),
  netWorth: z.number(),
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
  damage: z.number(),
  damageTaken: z.number(),
  lastHits: z.number(),
  possibleCreeps: z.number(),
  denies: z.number(),
  level: z.number(),
})

const storedSouls = z.object({
  heroes: z.number(),
  laneCreeps: z.number(),
  neutrals: z.number(),
  bosses: z.number(),
  treasure: z.number(),
  lostToDeaths: z.number(),
})

const storedPlayer = z.object({
  accountId: z.number(),
  name: z.string(),
  avatar: z.string().nullable(),
  team: z.number(),
  heroId: z.number(),
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
  netWorth: z.number(),
  lastHits: z.number(),
  denies: z.number(),
  level: z.number(),
  abandonedAtS: z.number().nullable(),
  damage: z.number().nullable(),
  healing: z.number().nullable(),
  damageTaken: z.number().nullable(),
  objectiveDamage: z.number().nullable(),
  accuracy: z.number().nullable(), // 0..1
  critRate: z.number().nullable(), // 0..1 of hero bullets hit
  items: z.array(storedItem),
  // v2 (defaults keep v1 rows readable)
  slot: z.number().nullable().default(null),
  lane: z.number().nullable().default(null),
  mvpRank: z.number().nullable().default(null), // Valve's: 1 = MVP, 2–3 = key players
  selfHealing: z.number().nullable().default(null),
  damageMitigated: z.number().nullable().default(null),
  deathDetails: z.array(storedDeath).default([]),
  snapshots: z.array(storedSnapshot).default([]),
  souls: storedSouls.nullable().default(null),
})

export const matchDetailSchema = z.object({
  v: z.number().int().min(1).max(MATCH_DETAIL_VERSION),
  matchId: z.number(),
  startTime: z.number(),
  durationS: z.number(),
  winningTeam: z.number(),
  gameMode: z.number(),
  matchMode: z.number(),
  avgBadge: z.tuple([z.number().nullable(), z.number().nullable()]),
  players: z.array(storedPlayer),
  netWorthTimeline: z.array(z.object({ t: z.number(), team0: z.number(), team1: z.number() })),
  // v2
  objectives: z.array(z.object({ team: z.number(), id: z.number(), t: z.number() })).default([]), // team = owner; destroyed ones only
  midBoss: z.array(z.object({ teamClaimed: z.number(), t: z.number() })).default([]),
})

export type MatchDetailData = z.infer<typeof matchDetailSchema>
export type MatchDetailPlayer = z.infer<typeof storedPlayer>
export type MatchDeath = z.infer<typeof storedDeath>
export type MatchSnapshot = z.infer<typeof storedSnapshot>

export const matchIdInput = z.object({
  matchId: z.coerce.number().int().positive(),
})
