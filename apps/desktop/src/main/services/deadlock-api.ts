import { z } from 'zod'

// Thin, validated client for https://api.deadlock-api.com (community API —
// Valve has no official one). Every response goes through a zod schema so
// nothing downstream needs `as` casts, and unknown fields are stripped.

const BASE_URL = 'https://api.deadlock-api.com'
const DEFAULT_TIMEOUT_MS = 15_000
const SLOW_LOG_MS = 1500

export class DeadlockApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** From a 429 body (`next_request_in`), when the API says. */
    readonly retryAfterS: number | null = null,
  ) {
    super(message)
    this.name = 'DeadlockApiError'
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }
}

type Params = Record<string, string | number | boolean | undefined>

interface FetchOptions {
  timeoutMs?: number
  /** Reference data (heroes/items/ranks); cached in memory by assets.ts. */
  edgeCacheTtl?: number
}

async function apiGet<T extends z.ZodType>(path: string, schema: T, params: Params = {}, opts: FetchOptions = {}): Promise<z.infer<T>> {
  const url = new URL(path, BASE_URL)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = { accept: 'application/json' }
  const apiKey = process.env.DEADLOCK_API_KEY
  if (apiKey) headers['X-API-KEY'] = apiKey

  const init: RequestInit = {
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  }

  let res: Response
  const started = Date.now()
  try {
    res = await fetch(url, init)
    const ms = Date.now() - started
    if (ms > SLOW_LOG_MS) console.warn(`[deadlock-api] slow ${ms}ms ${url.pathname}${url.search}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new DeadlockApiError(`Request to ${url.pathname} failed: ${reason}`, 0)
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new DeadlockApiError(`${url.pathname} returned ${res.status}${body ? `: ${body}` : ''}`, res.status, res.status === 429 ? retryAfterFrom(body, res) : null)
  }

  const json: unknown = await res.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new DeadlockApiError(`Unexpected response shape from ${url.pathname}: ${parsed.error.message.slice(0, 300)}`, 502)
  }
  return parsed.data
}

// 429 bodies look like {"status":429,"error":{"next_request_in":3539,...}}.
const rateLimitBody = z.object({ error: z.object({ next_request_in: z.number() }) })
function retryAfterFrom(body: string, res: Response): number | null {
  try {
    const parsed = rateLimitBody.safeParse(JSON.parse(body))
    if (parsed.success) return parsed.data.error.next_request_in
  } catch {
    // not JSON
  }
  const header = Number(res.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? header : null
}

// ---------------------------------------------------------------- players


const steamProfile = z.object({
  account_id: z.number(),
  personaname: z.string().nullish(),
  profileurl: z.string().nullish(),
  avatarmedium: z.string().nullish(),
  avatarfull: z.string().nullish(),
})
export type SteamProfile = z.infer<typeof steamProfile>

export function fetchSteamProfiles(accountIds: number[]) {
  if (accountIds.length === 0) return Promise.resolve([])
  return apiGet('/v1/players/steam', z.array(steamProfile), { account_ids: accountIds.join(',') })
}

export function searchSteamProfiles(query: string, limit = 10) {
  return apiGet('/v1/players/steam-search', z.array(steamProfile), { search_query: query, limit })
}

const accountRank = z.object({
  account_id: z.number(),
  /** tier * 10 + subrank; 0 when no recent ranked match reports a rank. */
  badge: z.number(),
})
export type AccountRank = z.infer<typeof accountRank>

/** Batch rank lookup (community API, not Steam). */
export function fetchPlayerRanks(accountIds: number[]) {
  if (accountIds.length === 0) return Promise.resolve([])
  return apiGet('/v1/players/rank', z.array(accountRank), { account_ids: accountIds.join(',') })
}


const mateStat = z.object({
  mate_id: z.number(),
  wins: z.number(),
  matches_played: z.number(),
})
export type MateStat = z.infer<typeof mateStat>

export function fetchMateStats(accountId: number) {
  return apiGet(`/v1/players/${accountId}/mate-stats`, z.array(mateStat), { min_matches_played: 2 })
}

// ---------------------------------------------------------------- matches

/**
 * One match's metadata file (Zstandard, exactly as Valve publishes it) from the
 * community API's cache.
 *
 * `disable_steam=true` keeps the request on their cached tier: a match they
 * haven't ingested answers a plain 404 instead of triggering a Steam fetch, so
 * this never spends a GC request — theirs or ours. Null means "not cached",
 * and the caller falls back to the Game Coordinator.
 */
const historyEntry = z.object({
  match_id: z.number(),
  hero_id: z.number(),
  hero_level: z.number(),
  start_time: z.number(),
  game_mode: z.number(),
  match_mode: z.number(),
  player_team: z.number(),
  player_kills: z.number(),
  player_deaths: z.number(),
  player_assists: z.number(),
  denies: z.number(),
  net_worth: z.number(),
  last_hits: z.number(),
  abandoned_time_s: z.number().nullish(),
  match_duration_s: z.number(),
  match_result: z.number(),
})

/**
 * A player's match history as deadlock-api has it stored: the same fields
 * as the Game Coordinator's history (HistoryEntry), no Steam request on our
 * side. only_stored_history stops the API from spending its own Steam
 * requests on our behalf, so it may lag the GC by a few matches.
 */
export function fetchCommunityMatchHistory(accountId: number) {
  return apiGet(`/v1/players/${accountId}/match-history`, z.array(historyEntry), { only_stored_history: true })
}

// ------------------------------------------------------------ analytics
// Benchmarks for the cross-match coaching (shared 200 req/min per IP across
// all analytics endpoints; responses are cached server-side for an hour).

const ANALYTICS_TIMEOUT_MS = 45_000

const metricDist = z.object({
  avg: z.number(),
  std: z.number(),
  percentile1: z.number(),
  percentile5: z.number(),
  percentile10: z.number(),
  percentile25: z.number(),
  percentile50: z.number(),
  percentile75: z.number(),
  percentile90: z.number(),
  percentile95: z.number(),
  percentile99: z.number(),
})
export type MetricDist = z.infer<typeof metricDist>

/** Per-match distribution of each stat (one row per player per match) for the filtered matches. */
export function fetchPlayerMetrics(params: { hero_ids?: string; account_ids?: string; min_average_badge?: number; max_average_badge?: number; min_unix_timestamp?: number; match_mode?: string; game_mode?: string; include_buff_metrics?: boolean }) {
  return apiGet('/v1/analytics/player-stats/metrics', z.record(z.string(), metricDist), params, { timeoutMs: ANALYTICS_TIMEOUT_MS })
}

const heroStat = z.object({
  hero_id: z.number(),
  matches: z.number(),
  wins: z.number(),
  total_player_damage: z.number(),
  total_boss_damage: z.number(),
  total_net_worth: z.number(),
  total_neutral_damage: z.number(),
  total_deaths: z.number(),
})
export type HeroStat = z.infer<typeof heroStat>

/** Totals per hero (matches, wins, damage, objective damage, souls…). */
export function fetchHeroStats(params: { min_average_badge?: number; max_average_badge?: number; min_unix_timestamp?: number; match_mode?: string; game_mode?: string }) {
  return apiGet('/v1/analytics/hero-stats', z.array(heroStat), params, { timeoutMs: ANALYTICS_TIMEOUT_MS })
}

const itemStat = z.object({
  item_id: z.number(),
  matches: z.number(),
  wins: z.number(),
  players: z.number(),
  avg_buy_time_s: z.number().nullish(),
})
export type ItemStat = z.infer<typeof itemStat>

/** How often and when each item is bought on a hero. */
export function fetchItemStats(params: { hero_id: number; min_average_badge?: number; max_average_badge?: number; min_unix_timestamp?: number; min_matches?: number; match_mode?: string; game_mode?: string }) {
  return apiGet('/v1/analytics/item-stats', z.array(itemStat), params, { timeoutMs: ANALYTICS_TIMEOUT_MS })
}

export async function fetchCachedMatchMetadata(matchId: number): Promise<Buffer | null> {
  const url = new URL(`/v1/matches/${matchId}/metadata/raw`, BASE_URL)
  url.searchParams.set('disable_steam', 'true')

  const headers: Record<string, string> = { accept: 'application/octet-stream' }
  const apiKey = process.env.DEADLOCK_API_KEY
  if (apiKey) headers['X-API-KEY'] = apiKey

  let res: Response
  const started = Date.now()
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
    const ms = Date.now() - started
    if (ms > SLOW_LOG_MS) console.warn(`[deadlock-api] slow ${ms}ms ${url.pathname}`)
  } catch (err) {
    throw new DeadlockApiError(`Request to ${url.pathname} failed: ${err instanceof Error ? err.message : String(err)}`, 0)
  }

  if (res.status === 404) return null
  if (!res.ok) throw new DeadlockApiError(`${url.pathname} returned ${res.status}`, res.status, res.status === 429 ? retryAfterFrom(await res.text().catch(() => ''), res) : null)

  const body = Buffer.from(await res.arrayBuffer())
  return body.length > 0 ? body : null
}

// ------------------------------------------------------------- reference data

const DAY = 60 * 60 * 24

const hero = z.object({
  id: z.number(),
  name: z.string(),
  player_selectable: z.boolean().nullish(),
  images: z
    .object({
      icon_image_small_webp: z.string().nullish(),
      icon_image_small: z.string().nullish(),
      icon_hero_card_webp: z.string().nullish(),
    })
    .nullish(),
})

export function fetchHeroes() {
  return apiGet('/v1/assets/heroes', z.array(hero), {}, { edgeCacheTtl: DAY })
}

const itemProperty = z.object({
  label: z.string().nullish(),
  value: z.union([z.string(), z.number()]).nullish(),
  prefix: z.string().nullish(),
  postfix: z.string().nullish(),
  negative_attribute: z.boolean().nullish(),
  tooltip_section: z.string().nullish(),
})

const tooltipSection = z.object({
  section_type: z.string().nullish(),
  section_attributes: z
    .array(
      z.object({
        loc_string: z.string().nullish(),
        properties: z.array(z.string()).nullish(),
        important_properties: z.array(z.string()).nullish(),
        elevated_properties: z.array(z.string()).nullish(),
      }),
    )
    .default([]),
})

const item = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().nullish(),
  activation: z.string().nullish(),
  properties: z.record(z.string(), itemProperty).nullish(),
  tooltip_sections: z.array(tooltipSection).nullish(),
  image_webp: z.string().nullish(),
  image: z.string().nullish(),
  shop_image_webp: z.string().nullish(),
  item_tier: z.number().nullish(),
  item_slot_type: z.string().nullish(),
  cost: z.number().nullish(),
  disabled: z.boolean().nullish(),
  shopable: z.boolean().nullish(),
})

export function fetchUpgradeItems() {
  return apiGet('/v1/assets/items/by-type/upgrade', z.array(item), {}, { edgeCacheTtl: DAY })
}

const rankTier = z.object({
  tier: z.number(),
  name: z.string(),
  color: z.string().nullish(),
  images: z.record(z.string(), z.string()).default({}),
})

export function fetchRanks() {
  return apiGet('/v1/assets/ranks', z.array(rankTier), {}, { edgeCacheTtl: DAY })
}
