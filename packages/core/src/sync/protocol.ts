import { z } from 'zod'

// Desktop ↔ cloud sync protocol (apps/cloud Worker, apps/desktop main).
// camelCase on the wire; snake_case in both databases.

const int = z.number().int()
const nonNeg = int.nonnegative()

export const cloudPlayer = z.object({
  accountId: int.positive(),
  personaName: z.string().max(200).nullable(),
  avatarUrl: z.string().max(500).nullable(),
  profileUrl: z.string().max(500).nullable(),
  rankBadge: int.nullable(),
  /** When this install last changed the profile fields (ISO). Last write wins. */
  updatedAt: z.string().max(40),
})
export type CloudPlayer = z.infer<typeof cloudPlayer>

export const cloudPlayerMatch = z.object({
  accountId: int.positive(),
  matchId: int.positive(),
  heroId: nonNeg,
  startTime: nonNeg,
  durationS: nonNeg,
  gameMode: nonNeg,
  matchMode: nonNeg,
  team: nonNeg,
  won: int.min(0).max(1),
  kills: nonNeg,
  deaths: nonNeg,
  assists: nonNeg,
  netWorth: nonNeg,
  lastHits: nonNeg,
  denies: nonNeg,
  heroLevel: nonNeg,
  abandonedTimeS: nonNeg,
})
export type CloudPlayerMatch = z.infer<typeof cloudPlayerMatch>

export const cloudMatchDetail = z.object({
  matchId: int.positive(),
  /** MATCH_DETAIL_VERSION of `data`; a higher version replaces a lower one. */
  v: int.positive(),
  /** Trimmed match detail JSON (validated by the Worker). */
  data: z.string().max(1_500_000),
  fetchedAt: z.string().max(40),
})
export type CloudMatchDetail = z.infer<typeof cloudMatchDetail>

export const PUSH_LIMITS = { players: 500, playerMatches: 2000, matchDetails: 40 } as const

export const pushBody = z.object({
  players: z.array(cloudPlayer).max(PUSH_LIMITS.players).default([]),
  playerMatches: z.array(cloudPlayerMatch).max(PUSH_LIMITS.playerMatches).default([]),
  matchDetails: z.array(cloudMatchDetail).max(PUSH_LIMITS.matchDetails).default([]),
})
export type PushBody = z.infer<typeof pushBody>

export interface PushResult {
  /** Rows that changed something in the cloud (new, or newer than what it had). */
  changed: { players: number; playerMatches: number; matchDetails: number }
}

export const PULL_PAGE = 500

export interface PullResult {
  players: CloudPlayer[]
  playerMatches: CloudPlayerMatch[]
  /** Matches whose details changed; fetch with POST /v1/details/get when relevant. */
  detailIds: number[]
  nextSeq: number
  done: boolean
}

export const detailsLookupBody = z.object({ matchIds: z.array(int.positive()).max(1000), minVersion: int.positive() })
export const DETAILS_GET_MAX = 25
export const detailsGetBody = z.object({ matchIds: z.array(int.positive()).max(DETAILS_GET_MAX) })

export interface MeResult {
  accountId: number
  name: string
  role: 'admin' | 'member'
}

export const allowlistBody = z.object({ accountId: int.positive(), role: z.enum(['admin', 'member']).default('member'), note: z.string().max(100).optional() })
export interface AllowlistEntry {
  accountId: number
  role: 'admin' | 'member'
  note: string | null
  addedAt: string
}
