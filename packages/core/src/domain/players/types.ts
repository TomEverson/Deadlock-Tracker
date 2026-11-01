import type { HeroInfo, RankInfo } from '../assets/types'

export interface PlayerProfile {
  accountId: number
  name: string
  avatar: string | null
  profileUrl: string | null
}

export interface PlayerMatchRow {
  matchId: number
  hero: HeroInfo
  startTime: number // unix seconds
  durationS: number
  won: boolean
  abandoned: boolean
  kills: number
  deaths: number
  assists: number
  netWorth: number
  lastHits: number
  denies: number
  level: number
  mode: string
}

export interface HeroStatRow {
  hero: HeroInfo
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgNetWorth: number
  lastPlayed: number
}

export interface PlayerSummary {
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgNetWorth: number
  avgDurationS: number
  /** Most recent first. */
  recentForm: boolean[]
}

export interface Freshness {
  lastSyncedAt: string | null
  latestMatchAt: number | null // unix seconds
}

export interface PlayerOverview {
  profile: PlayerProfile
  rank: RankInfo | null
  freshness: Freshness
  summary: PlayerSummary
  heroes: HeroStatRow[]
  matches: PlayerMatchRow[]
  totalMatches: number
}

export interface Mate {
  accountId: number
  name: string
  avatar: string | null
  games: number
  wins: number
}

export interface PlayerSearchResult {
  accountId: number
  name: string
  avatar: string | null
}

export interface Friend {
  accountId: number
  name: string
  avatar: string | null
  rank: RankInfo | null
  games: number
  wins: number
  /** Unix seconds of their latest stored match. */
  lastMatchAt: number | null
}

export interface FriendList {
  /** The app's connected Steam account; null before the first sync. */
  self: Friend | null
  /** Friends with at least one stored match, most recently played first. */
  friends: Friend[]
  /** Friends with no stored Deadlock matches (not synced yet, or don't play). */
  withoutMatches: number
}
