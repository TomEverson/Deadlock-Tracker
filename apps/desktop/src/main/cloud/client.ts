import type { MeResult } from '@deadlock/core/sync/protocol'
import { deleteSecret, readSecret, saveSecret } from '../secrets'
import { deleteState, getState, setState } from '../sync/state'

// The Deadlock Tracker cloud Worker. Override with DEADLOCK_CLOUD_URL (e.g.
// http://localhost:8787 for `wrangler dev`).
export const CLOUD_URL = (process.env.DEADLOCK_CLOUD_URL ?? 'https://deadlock-cloud.studycafe-125.workers.dev').replace(/\/$/, '')

const TIMEOUT_MS = 30_000

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

export const getCloudToken = () => readSecret('cloud-session')

export async function saveCloudSession(token: string, me: MeResult): Promise<void> {
  await saveSecret('cloud-session', token)
  await setState('cloud.account', me)
}

export async function clearCloudSession(): Promise<void> {
  deleteSecret('cloud-session')
  await deleteState('cloud.account')
}

export const getCloudAccount = () => getState<MeResult>('cloud.account')

/** Authenticated JSON request. 401 clears the local session (signed out elsewhere / expired). */
export async function cloudFetch<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const token = init.token ?? (await getCloudToken())
  if (!token) throw new CloudError('Not signed in to the cloud', 401)
  let res: Response
  try {
    res = await fetch(`${CLOUD_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new CloudError(`Can't reach the cloud: ${err instanceof Error ? err.message : String(err)}`, 0)
  }
  if (res.status === 401 && !init.token) await clearCloudSession()
  if (!res.ok) {
    const message = await res
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null)
    throw new CloudError(message ?? `Cloud returned ${res.status}`, res.status)
  }
  return (await res.json()) as T
}
