import type { ColumnType } from 'kysely'

// Local SQLite schema (camelCase via CamelCasePlugin). Keep in sync with
// ./migrations — each migration that changes a table updates this file.

type Generated<T> = T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>

export interface MatchDetail {
  data: string
  fetchedAt: string
  matchId: number
}

export interface MatchDetailAttempt {
  attemptedAt: string
  error: string
  matchId: number
}

export interface Player {
  accountId: number
  avatarUrl: string | null
  createdAt: string
  historyVerifiedUntil: number | null
  isFriend: Generated<number>
  isSelf: Generated<number>
  lastForceRefetchAt: string | null
  lastSyncedAt: string | null
  lastViewedAt: string | null
  personaName: string | null
  profileUrl: string | null
  rankBadge: number | null
}

export interface PlayerMatch {
  abandonedTimeS: Generated<number>
  accountId: number
  assists: number
  deaths: number
  denies: number
  durationS: number
  gameMode: number
  heroId: number
  heroLevel: number
  kills: number
  lastHits: number
  matchId: number
  matchMode: number
  netWorth: number
  startTime: number
  team: number
  won: number
}

export interface SyncLog {
  accountId: number
  createdAt: string
  error: string | null
  id: Generated<number>
  newMatches: Generated<number>
  status: string
  trigger: string
}

export interface Outbox {
  tbl: 'player' | 'player_match' | 'match_detail'
  k1: number
  k2: Generated<number>
  queuedAt: string
}

export interface SyncState {
  key: string
  value: string
}

export interface DB {
  matchDetail: MatchDetail
  matchDetailAttempt: MatchDetailAttempt
  outbox: Outbox
  player: Player
  playerMatch: PlayerMatch
  syncLog: SyncLog
  syncState: SyncState
}
