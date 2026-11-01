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
 * Rolling 24h logs of Game Coordinator requests. Valve publishes no limits;
 * deadlock-api budgets each account at ~50/day for history and ~50/day for
 * match details, and Steam answered RateLimited at ~55 details in testing.
 * We stay under both.
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

// After Steam says RateLimited, leave it alone for a while (deadlock-api's
// bots rest ~2h too).
const BACKOFF_KEY = 'gc.backoffUntil'
export const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 60 * 1000

export async function backoffUntil(): Promise<number | null> {
  const until = await getState<number>(BACKOFF_KEY)
  return until && until > Date.now() ? until : null
}

export async function startBackoff(): Promise<number> {
  const until = Date.now() + RATE_LIMIT_BACKOFF_MS
  await setState(BACKOFF_KEY, until)
  return until
}
