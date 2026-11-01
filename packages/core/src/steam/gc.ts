import SteamUser from 'steam-user'
import { z } from 'zod'
import type { HistoryEntry } from '../domain/players/services/match-rows'
import { ClientHello, GetMatchHistory, GetMatchHistoryResponse, GetMatchMetaData, GetMatchMetaDataResponse, decode, encode } from './proto'

export const DEADLOCK_APP_ID = 1422450
const MSG = { CLIENT_WELCOME: 4004, CLIENT_HELLO: 4006, GET_MATCH_HISTORY: 9112, GET_MATCH_METADATA: 9167 } as const

// What the real game client sends: Source 2 engine, no partner launcher.
const HELLO = { client_session_need: 104, client_launcher: 0, engine: 1 }
const HELLO_INTERVAL_MS = 5_000
const WELCOME_TIMEOUT_MS = 45_000
const REQUEST_TIMEOUT_MS = 20_000
const LOGON_TIMEOUT_MS = 30_000
// Steam reports whether this account is already in a game elsewhere shortly
// after logon. Wait this long for that before touching the Game Coordinator.
const PLAYING_STATE_WAIT_MS = 3_000
const FRIENDS_LIST_TIMEOUT_MS = 10_000
const STEAM_ID64_BASE = 76561197960265728n
// Arbitrary but fixed, so we never collide with (and kick) your Steam client.
const LOGON_ID = 0x444c4b54

// CMsgClientToGCGetMatchHistoryResponse.EResult
const HISTORY_RESULT = { SUCCESS: 1, INVALID_PERMISSION: 2, TEMPORARILY_DISABLED: 3, TOO_BUSY: 4, RATE_LIMITED: 5 } as const
// CMsgClientToGCGetMatchMetaDataResponse.EResult
const METADATA_RESULT = {
  SUCCESS: 1,
  INVALID_PERMISSION: 2,
  TEMPORARILY_DISABLED: 3,
  TOO_BUSY: 4,
  RATE_LIMITED: 5,
  INVALID_MATCH: 6,
  MATCH_IN_FLIGHT: 7,
  TIMEOUT: 8,
} as const
// Gap kept between any two GC requests (history pages, metadata lookups).
const REQUEST_GAP_MS = 1_500

export type GcErrorCode = 'in_game' | 'login' | 'timeout' | 'not_friends' | 'rate_limited' | 'busy' | 'gc_error' | 'in_flight' | 'invalid_match'

export class GcError extends Error {
  constructor(
    readonly code: GcErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GcError'
  }
}

const historyResponse = z.object({
  result: z.number(),
  continue_cursor: z.string(),
  matches: z.array(
    z.object({
      match_id: z.coerce.number(),
      hero_id: z.number(),
      match_duration_s: z.number(),
      start_time: z.number(),
      match_result: z.number(),
      player_team: z.number(),
      player_kills: z.number(),
      player_deaths: z.number(),
      player_assists: z.number(),
      last_hits: z.number(),
      denies: z.number(),
      hero_level: z.number(),
      net_worth: z.number(),
      abandoned_time_s: z.number(),
      match_mode: z.number(),
      game_mode: z.number(),
    }),
  ),
})

const metadataResponse = z.object({
  result: z.number(),
  metadata_salt: z.number(),
  replay_group_id: z.number(),
})

/** Where a match's metadata file lives on Valve's replay servers. */
export interface MatchSalts {
  matchId: number
  clusterId: number
  metadataSalt: number
}

const persona = z.object({
  player_name: z.string().optional(),
  avatar_url_full: z.string().optional(),
  avatar_url_medium: z.string().optional(),
})

export interface SteamPersona {
  name: string | null
  avatar: string | null
}

export interface HistoryPage {
  matches: HistoryEntry[]
  /** Pass back to get the next (older) page; null when there is none. */
  cursor: string | null
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => GcError): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * A short-lived session with Deadlock's Game Coordinator on YOUR Steam
 * account: log on -> make sure you're not in a game -> report "playing"
 * Deadlock -> ClientHello until ClientWelcome -> requests -> log off.
 */
export class DeadlockGc {
  private readonly client = new SteamUser({ autoRelogin: false, renewRefreshTokens: true })
  private helloTimer: NodeJS.Timeout | null = null
  private fatal: GcError | null = null
  private lastRequestAt = 0
  // Steam sends the full friends list shortly after logon (possibly while
  // connect() is still waiting on playingState), so listen from the start.
  private readonly friendsListLoaded: Promise<void>

  constructor(private readonly onRefreshToken: (token: string) => void) {
    this.friendsListLoaded = new Promise((resolve) => this.client.once('friendsList', () => resolve()))
    this.client.on('refreshToken', (token) => this.onRefreshToken(token))
    // If you start Deadlock on your PC mid-sync, Steam hands the game session
    // to you and ends ours. That's the right outcome; just stop cleanly.
    this.client.on('playingState', (blocked) => {
      if (blocked) this.fatal ??= new GcError('in_game', 'You started a game on this account, so the sync stopped. Run it again after the match.')
    })
  }

  get accountId(): number {
    const id = this.client.steamID?.accountid
    if (!id) throw new GcError('login', 'Not logged on')
    return id
  }

  async connect(refreshToken: string): Promise<void> {
    const loggedOn = new Promise<void>((resolve, reject) => {
      this.client.once('loggedOn', () => resolve())
      this.client.once('error', (err) => {
        const needsLogin = [
          SteamUser.EResult.InvalidPassword,
          SteamUser.EResult.AccessDenied,
          SteamUser.EResult.Expired,
          SteamUser.EResult.Revoked,
          SteamUser.EResult.InvalidSignature,
        ].includes(err.eresult)
        reject(new GcError('login', needsLogin ? `Saved Steam login is no longer valid (${err.message}). Reconnect Steam in Settings.` : `Steam logon failed: ${err.message}`))
      })
    })
    this.client.logOn({ refreshToken, logonID: LOGON_ID })
    await withTimeout(loggedOn, LOGON_TIMEOUT_MS, () => new GcError('timeout', 'Steam logon timed out'))

    // Never kick your real game session: if you're in a game, bail out.
    const blocked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), PLAYING_STATE_WAIT_MS)
      this.client.once('playingState', (isBlocked) => {
        clearTimeout(timer)
        resolve(isBlocked)
      })
    })
    if (blocked) throw new GcError('in_game', "You're in a game on this account right now. Run the sync after the match.")
  }

  async openGameCoordinator(): Promise<void> {
    const welcome = new Promise<void>((resolve) => {
      const onMessage = (appid: number, msgType: number) => {
        if (appid === DEADLOCK_APP_ID && msgType === MSG.CLIENT_WELCOME) {
          this.client.off('receivedFromGC', onMessage)
          resolve()
        }
      }
      this.client.on('receivedFromGC', onMessage)
    })

    // force = false: Steam refuses rather than kicking another game session.
    this.client.gamesPlayed([DEADLOCK_APP_ID], false)
    const hello = encode(ClientHello, HELLO)
    const sendHello = () => {
      this.throwIfFatal()
      this.client.sendToGC(DEADLOCK_APP_ID, MSG.CLIENT_HELLO, {}, hello)
    }
    sendHello()
    this.helloTimer = setInterval(sendHello, HELLO_INTERVAL_MS)
    try {
      await withTimeout(welcome, WELCOME_TIMEOUT_MS, () => new GcError('timeout', 'Deadlock Game Coordinator did not answer (is Deadlock in this account\'s library?)'))
    } finally {
      if (this.helloTimer) clearInterval(this.helloTimer)
      this.helloTimer = null
    }
  }

  async getMatchHistoryPage(accountId: number, cursor: string | null): Promise<HistoryPage> {
    this.throwIfFatal()
    await this.pace()
    const body: Record<string, unknown> = { account_id: accountId }
    if (cursor) body.continue_cursor = cursor

    const payload = await withTimeout(
      new Promise<Buffer>((resolve) => {
        this.client.sendToGC(DEADLOCK_APP_ID, MSG.GET_MATCH_HISTORY, {}, encode(GetMatchHistory, body), (_appid, _type, response) => resolve(response))
      }),
      REQUEST_TIMEOUT_MS,
      () => this.fatal ?? new GcError('timeout', 'Game Coordinator did not answer the match history request'),
    )

    const parsed = historyResponse.safeParse(decode(GetMatchHistoryResponse, payload))
    if (!parsed.success) throw new GcError('gc_error', `Unexpected match history response: ${parsed.error.message.slice(0, 200)}`)
    const { result, continue_cursor, matches } = parsed.data

    switch (result) {
      case HISTORY_RESULT.SUCCESS:
        return { matches, cursor: continue_cursor !== '0' && matches.length > 0 ? continue_cursor : null }
      case HISTORY_RESULT.INVALID_PERMISSION:
        throw new GcError('not_friends', `Steam won't show match history for ${accountId} — you need to be Steam friends with them.`)
      case HISTORY_RESULT.RATE_LIMITED:
        throw new GcError('rate_limited', 'Steam rate-limited match history requests. Wait ~30 min before syncing again.')
      case HISTORY_RESULT.TOO_BUSY:
      case HISTORY_RESULT.TEMPORARILY_DISABLED:
        throw new GcError('busy', 'Steam says match history is busy or temporarily disabled. Try again later.')
      default:
        throw new GcError('gc_error', `Match history request failed (result ${result})`)
    }
  }

  /**
   * Salts for a match's metadata file (GC msg 9167). The GC answers for
   * matches you or your friends played; very recent ones may still be
   * "in flight".
   */
  async getMatchSalts(matchId: number): Promise<MatchSalts> {
    this.throwIfFatal()
    await this.pace()
    const payload = await withTimeout(
      new Promise<Buffer>((resolve) => {
        this.client.sendToGC(DEADLOCK_APP_ID, MSG.GET_MATCH_METADATA, {}, encode(GetMatchMetaData, { match_id: matchId }), (_appid, _type, response) => resolve(response))
      }),
      REQUEST_TIMEOUT_MS,
      () => this.fatal ?? new GcError('timeout', 'Game Coordinator did not answer the match details request'),
    )
    const parsed = metadataResponse.safeParse(decode(GetMatchMetaDataResponse, payload))
    if (!parsed.success) throw new GcError('gc_error', `Unexpected match details response: ${parsed.error.message.slice(0, 200)}`)
    const { result, metadata_salt, replay_group_id } = parsed.data

    switch (result) {
      case METADATA_RESULT.SUCCESS:
        if (!metadata_salt) throw new GcError('gc_error', `Steam returned no metadata for match ${matchId}.`)
        return { matchId, clusterId: replay_group_id, metadataSalt: metadata_salt }
      case METADATA_RESULT.MATCH_IN_FLIGHT:
        throw new GcError('in_flight', `Match ${matchId} is still being processed by Steam. Try again in a little while.`)
      case METADATA_RESULT.INVALID_MATCH:
        throw new GcError('invalid_match', `Steam doesn't know match ${matchId}.`)
      case METADATA_RESULT.INVALID_PERMISSION:
        throw new GcError('not_friends', `Steam won't give details for match ${matchId} to this account.`)
      case METADATA_RESULT.RATE_LIMITED:
        throw new GcError('rate_limited', 'Steam rate-limited match details requests. Wait ~30 min before trying again.')
      case METADATA_RESULT.TOO_BUSY:
      case METADATA_RESULT.TEMPORARILY_DISABLED:
      case METADATA_RESULT.TIMEOUT:
        throw new GcError('busy', 'Steam says match details are busy or temporarily disabled. Try again later.')
      default:
        throw new GcError('gc_error', `Match details request failed (result ${result})`)
    }
  }

  /** Name + avatar over the normal Steam connection (no Game Coordinator cost). */
  async getProfile(accountId: number): Promise<SteamPersona> {
    return (await this.getProfiles([accountId])).get(accountId) ?? { name: null, avatar: null }
  }

  /** Batch version of getProfile; accounts Steam doesn't answer for are left out. */
  async getProfiles(accountIds: number[]): Promise<Map<number, SteamPersona>> {
    const out = new Map<number, SteamPersona>()
    if (accountIds.length === 0) return out
    try {
      const ids = accountIds.map((id) => [id, (STEAM_ID64_BASE + BigInt(id)).toString()] as const)
      const { personas } = await this.client.getPersonas(ids.map(([, id64]) => id64))
      for (const [id, id64] of ids) {
        const p = persona.safeParse(personas[id64])
        if (p.success) out.set(id, { name: p.data.player_name ?? null, avatar: p.data.avatar_url_full ?? p.data.avatar_url_medium ?? null })
      }
    } catch {
      // names are cosmetic; callers fall back to what's stored
    }
    return out
  }

  /**
   * SteamID3s of your Steam friends (accepted friendships only), over the
   * normal Steam connection (no Game Coordinator cost). Null if the list
   * didn't arrive in time.
   */
  async getFriendAccountIds(): Promise<number[] | null> {
    const loaded = await withTimeout(
      this.friendsListLoaded.then(() => true),
      FRIENDS_LIST_TIMEOUT_MS,
      () => new GcError('timeout', 'Steam friends list did not arrive'),
    ).catch(() => false)
    if (!loaded) return null
    return Object.entries(this.client.myFriends)
      .filter(([, relationship]) => relationship === SteamUser.EFriendRelationship.Friend)
      .map(([id64]) => Number(BigInt(id64) - STEAM_ID64_BASE))
  }

  /** Stop "playing" and log off. Safe to call more than once. */
  disconnect(): void {
    if (this.helloTimer) clearInterval(this.helloTimer)
    this.helloTimer = null
    try {
      this.client.gamesPlayed([])
      this.client.logOff()
    } catch {
      // already disconnected
    }
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + REQUEST_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastRequestAt = Date.now()
  }

  private throwIfFatal(): void {
    if (this.fatal) throw this.fatal
  }
}
