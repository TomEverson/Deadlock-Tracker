import type { MatchDetailResult } from '@deadlock/core/domain/matches/types'
import type { FriendList, Mate, PlayerOverview, PlayerSearchResult } from '@deadlock/core/domain/players/types'
import type { MeResult } from '@deadlock/core/sync/protocol'

// The renderer ↔ main contract. Each method is one ipcMain.handle channel
// ("players:overview" etc.); the preload exposes them as window.api.

export type SearchResult =
  | { kind: 'invalid' }
  | { kind: 'account'; accountId: number }
  | { kind: 'results'; query: string; results: PlayerSearchResult[] }
  | { kind: 'error'; message: string }

export type MatesResult = { kind: 'ok'; mates: Mate[] } | { kind: 'unavailable'; mates: Mate[] }

export interface SteamAccount {
  accountId: number
  name: string | null
}

/** Progress of a Steam client login (Settings → Steam). */
export type SteamLoginEvent =
  | { kind: 'qr'; image: string }
  | { kind: 'scanned' }
  | { kind: 'guard'; method: 'device-code' | 'email-code'; detail?: string; canConfirm: boolean; wrongCode?: boolean }
  | { kind: 'confirm' }
  | { kind: 'done'; account: SteamAccount }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

export interface CloudSyncResult {
  pushed: number
  pulled: number
  detailsPulled: number
}

export interface SyncRunSummary {
  at: string
  trigger: 'auto' | 'manual'
  newMatches: number
  players: number
  cloud: CloudSyncResult | null
  note: string | null
}

export interface SyncStatus {
  state: 'idle' | 'running'
  step: string | null
  progress: { done: number; total: number } | null
  /** Why the last run stopped or failed, in plain words. */
  message: string | null
  messageTone: 'info' | 'warn' | 'error' | null
  last: SyncRunSummary | null
  backoffUntil: string | null
  budgets: { history: { used: number }; details: { used: number } }
  steam: SteamAccount | null
  hasCliLogin: boolean
}

export interface CloudStatus {
  url: string
  account: MeResult | null
  /** Result of the last automatic sign-in attempt (when not signed in). */
  signIn: { kind: 'error'; message: string; at: string } | null
  lastSync: { at: string; error: string | null } | null
  /** Local changes not pushed yet. */
  pending: number
}

export interface DesktopApi {
  platform: NodeJS.Platform
  players: {
    overview(accountId: number): Promise<PlayerOverview>
    mates(accountId: number): Promise<MatesResult>
    friends(): Promise<FriendList>
    search(q: string): Promise<SearchResult>
    selfAccountId(): Promise<number | null>
  }
  matches: {
    detail(matchId: number): Promise<MatchDetailResult>
  }
  steam: {
    loginQr(): Promise<void>
    loginPassword(accountName: string, password: string): Promise<void>
    submitCode(code: string): Promise<void>
    cancelLogin(): Promise<void>
    disconnect(): Promise<void>
    importCliLogin(): Promise<SteamAccount>
  }
  cloud: {
    status(): Promise<CloudStatus>
    /** Retry signing in to the cloud with the connected Steam account. */
    signIn(): Promise<void>
  }
  sync: {
    status(): Promise<SyncStatus>
    /** Sync now: everyone, or one account. Resolves when the run starts. */
    run(options?: { accountId?: number; full?: boolean }): Promise<void>
    /** Get one match's details (cloud first, then Steam). */
    match(matchId: number): Promise<{ ok: true } | { ok: false; message: string }>
  }
  /** Subscribe to main-process events; returns an unsubscribe function. */
  on<E extends keyof DesktopEvents>(event: E, listener: (payload: DesktopEvents[E]) => void): () => void
}

export interface DesktopEvents {
  'sync:status': SyncStatus
  'steam:login': SteamLoginEvent
  /** Local data changed (sync finished, import…): reload what's on screen. */
  'data:changed': null
}

export const EVENTS = ['sync:status', 'steam:login', 'data:changed'] as const satisfies readonly (keyof DesktopEvents)[]

/** Channel names, derived from the contract: "players:overview", … */
export const CHANNELS = {
  players: ['overview', 'mates', 'friends', 'search', 'selfAccountId'],
  matches: ['detail'],
  steam: ['loginQr', 'loginPassword', 'submitCode', 'cancelLogin', 'disconnect', 'importCliLogin'],
  cloud: ['status', 'signIn'],
  sync: ['status', 'run', 'match'],
} as const satisfies { [K in Exclude<keyof DesktopApi, 'platform' | 'on'>]: readonly (keyof DesktopApi[K])[] }
