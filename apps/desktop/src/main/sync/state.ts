import { db } from '../db'

// Typed access to the sync_state key/value table.

export async function getState<T>(key: string): Promise<T | null> {
  const row = await db().selectFrom('syncState').select('value').where('key', '=', key).executeTakeFirst()
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export async function setState(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value)
  await db().insertInto('syncState').values({ key, value: json }).onConflict((oc) => oc.column('key').doUpdateSet({ value: json })).execute()
}

export async function deleteState(key: string): Promise<void> {
  await db().deleteFrom('syncState').where('key', '=', key).execute()
}

// ------------------------------------------------------------ request budgets

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Rolling 24h logs of Game Coordinator requests. Valve publishes no limits, so
 * these caps are only a local safety valve to stop a runaway sync; Steam's
 * RateLimited answer is the real limit, and the engine backs off when it says so.
 * deadlock-api budgets each account at ~50/day for history and ~50/day for
 * match details.
 */
export const BUDGETS = {
  history: { key: 'gc.log.history', limit: 40 },
  details: { key: 'gc.log.details', limit: 45 },
} as const
export type BudgetName = keyof typeof BUDGETS

async function recent(name: BudgetName): Promise<number[]> {
  const log = (await getState<number[]>(BUDGETS[name].key)) ?? []
  const cutoff = Date.now() - DAY_MS
  return log.filter((t) => t > cutoff)
}

export async function budgetUsed(name: BudgetName): Promise<number> {
  return (await recent(name)).length
}

export async function budgetLeft(name: BudgetName): Promise<number> {
  return Math.max(0, BUDGETS[name].limit - (await budgetUsed(name)))
}

export async function recordRequest(name: BudgetName): Promise<void> {
  const log = await recent(name)
  log.push(Date.now())
  await setState(BUDGETS[name].key, log)
}

// ------------------------------------------------------------ rate-limit backoff

/**
 * Steam's GC limit is per Steam account and comes with no reset time: the only
 * signal is a `RateLimited` result. Coming back too early earns another
 * refusal, so each kind of request keeps its own window (a short detail pause
 * must not freeze a whole sync) and the window doubles on every fresh refusal.
 * One successful request clears that window and its strikes again.
 */
interface BackoffState {
  until: number
  /** Consecutive refusals, for the doubling. */
  strikes: number
  /** When the last refusal happened. */
  at: number
}

export const BACKOFFS = {
  // deadlock-api's bots rest ~2h after a refusal.
  history: { key: 'gc.backoff.history', baseMs: 2 * 60 * 60 * 1000, maxMs: 12 * 60 * 60 * 1000 },
  // Detail requests recover faster; Steam's message says roughly 30 minutes.
  details: { key: 'gc.backoff.details', baseMs: 30 * 60 * 1000, maxMs: 4 * 60 * 60 * 1000 },
} as const
export type BackoffName = keyof typeof BACKOFFS

// Older installs kept one shared window in this key. Keep honouring it once so
// an upgrade doesn't retry straight into a limit that is still active.
const LEGACY_BACKOFF_KEY = 'gc.backoffUntil'
// Strikes are forgotten after a day, so a limit next week starts at the base window again.
const STRIKE_MEMORY_MS = 24 * 60 * 60 * 1000

async function readBackoff(name: BackoffName): Promise<BackoffState | null> {
  const state = await getState<BackoffState>(BACKOFFS[name].key)
  if (state && typeof state.until === 'number') return state
  // An older install's shared window still applies to both kinds. It is only
  // deleted once a per-kind window replaces it, so a read here has no race.
  const legacy = await getState<number>(LEGACY_BACKOFF_KEY)
  if (typeof legacy !== 'number') return null
  // The old key only stored "until"; approximate when the refusal happened so a
  // stale window doesn't count as a fresh strike.
  return { until: legacy, strikes: 1, at: legacy - BACKOFFS[name].baseMs }
}

/** When this kind of request may run again, or null if it isn't paused. */
export async function backoffFor(name: BackoffName): Promise<number | null> {
  const state = await readBackoff(name)
  return state && state.until > Date.now() ? state.until : null
}

/** The latest pause across all kinds, for the "Steam is paused" banner. */
export async function backoffUntil(): Promise<number | null> {
  const active = (await Promise.all((Object.keys(BACKOFFS) as BackoffName[]).map(backoffFor))).filter((t): t is number => t !== null)
  return active.length > 0 ? Math.max(...active) : null
}

/** Record a RateLimited answer and push the window out. Returns the new resume time. */
export async function startBackoff(name: BackoffName, durationMs?: number): Promise<number> {
  const now = Date.now()
  const prev = await readBackoff(name)
  const strikes = prev && now - prev.at < STRIKE_MEMORY_MS ? prev.strikes + 1 : 1
  const { baseMs, maxMs } = BACKOFFS[name]
  const wait = durationMs ?? Math.min(baseMs * 2 ** (strikes - 1), maxMs)
  const until = Math.max(prev?.until ?? 0, now + wait)
  await setState(BACKOFFS[name].key, { until, strikes, at: now } satisfies BackoffState)
  await deleteState(LEGACY_BACKOFF_KEY)
  return until
}

/** A request got through: forget the pause and the strikes behind it. */
export async function clearBackoff(name: BackoffName): Promise<void> {
  await deleteState(BACKOFFS[name].key)
}
