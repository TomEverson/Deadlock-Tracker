import { BrowserWindow, Notification } from 'electron'
import type { SyncRunSummary, SyncStatus } from '../../shared/api'
import { broadcast } from '../broadcast'
import { ensureCloudSession } from '../cloud/auth'
import { cloudDetailsSource, cloudSync } from '../cloud/sync'
import { db } from '../db'
import { getSteamAccount, hasCliLogin } from '../steam/account'
import { runSync, syncOneMatch, SyncAbort, type SyncOptions } from './engine'
import { BUDGETS, backoffUntil, budgetUsed, getState, setState } from './state'

// Runs sync on launch, every 30 minutes and on demand; keeps one status
// object that the renderer mirrors (sidebar widget, Settings).

const FIRST_RUN_DELAY_MS = 15_000
const INTERVAL_MS = 30 * 60 * 1000

let running = false
let live: Pick<SyncStatus, 'step' | 'progress' | 'message' | 'messageTone'> = { step: null, progress: null, message: null, messageTone: null }
let nextAutoAt: number | null = null

export async function getSyncStatus(): Promise<SyncStatus> {
  const until = await backoffUntil()
  return {
    state: running ? 'running' : 'idle',
    ...live,
    last: await getState<SyncRunSummary>('sync.last'),
    nextAutoAt: nextAutoAt ? new Date(nextAutoAt).toISOString() : null,
    backoffUntil: until ? new Date(until).toISOString() : null,
    budgets: {
      history: { used: await budgetUsed('history'), limit: BUDGETS.history.limit },
      details: { used: await budgetUsed('details'), limit: BUDGETS.details.limit },
    },
    steam: await getSteamAccount(),
    hasCliLogin: hasCliLogin(),
  }
}

async function publish(): Promise<void> {
  broadcast('sync:status', await getSyncStatus())
}

async function notifyNewMatches(newByAccount: Record<number, number>, self: number): Promise<void> {
  if (!Notification.isSupported() || BrowserWindow.getFocusedWindow()) return
  const mine = newByAccount[self] ?? 0
  const friendIds = Object.keys(newByAccount).map(Number).filter((id) => id !== self)
  if (mine === 0 && friendIds.length === 0) return
  const names = (await db().selectFrom('player').select('personaName').where('accountId', 'in', friendIds.length ? friendIds : [-1]).execute())
    .map((r) => r.personaName)
    .filter(Boolean)
  const parts = [mine ? `${mine} new match${mine === 1 ? '' : 'es'}` : null, friendIds.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''} played` : null]
  new Notification({ title: 'Deadlock Tracker', body: parts.filter(Boolean).join(' · ') }).show()
}

async function run(trigger: 'auto' | 'manual', opts: SyncOptions = {}): Promise<void> {
  if (running) return
  running = true
  live = { step: 'Starting', progress: null, message: null, messageTone: null }
  await publish()
  const summary: SyncRunSummary = { at: new Date().toISOString(), trigger, newMatches: 0, players: 0, detailsFetched: 0, detailsFromCloud: 0, detailsRemaining: 0, cloud: null, note: null }
  try {
    // Pull first so other installs' data (and match details) are here before we ask Steam.
    live.step = 'Syncing with the cloud'
    await publish()
    await ensureCloudSession().catch(() => null)
    summary.cloud = await cloudSync().catch(() => null)

    if (await getSteamAccount()) {
      try {
        const r = await runSync(
          opts,
          (p) => {
            live.step = p.step
            live.progress = p.total ? { done: p.done ?? 0, total: p.total } : null
            void publish()
          },
          cloudDetailsSource(),
        )
        Object.assign(summary, {
          newMatches: r.newMatches,
          players: r.players,
          detailsFetched: r.details.fetched,
          detailsFromCloud: r.details.fromCloud,
          detailsRemaining: r.details.remaining,
          note: r.stoppedBecause ?? (r.errors.length ? r.errors[0] : null),
        })
        live.message = r.stoppedBecause
        live.messageTone = r.stoppedBecause ? 'warn' : null
        if (trigger === 'auto') void notifyNewMatches(r.newByAccount, r.selfAccountId)
      } catch (err) {
        live.message = err instanceof Error ? err.message : String(err)
        live.messageTone = err instanceof SyncAbort ? 'warn' : 'error'
        summary.note = live.message
      }
      // Push what this run downloaded so other installs don't need to.
      const pushed = await cloudSync().catch(() => null)
      if (pushed && summary.cloud) summary.cloud.pushed += pushed.pushed
      else summary.cloud ??= pushed
    } else {
      live.message = 'Connect your Steam account in Settings to sync matches.'
      live.messageTone = 'info'
    }
    await setState('sync.last', summary)
  } finally {
    running = false
    live.step = null
    live.progress = null
    await publish()
    broadcast('data:changed', null)
  }
}

export function startScheduler(): void {
  nextAutoAt = Date.now() + FIRST_RUN_DELAY_MS
  setTimeout(() => {
    void run('auto')
    setInterval(() => {
      nextAutoAt = Date.now() + INTERVAL_MS
      void run('auto')
    }, INTERVAL_MS)
    nextAutoAt = Date.now() + INTERVAL_MS
  }, FIRST_RUN_DELAY_MS)
}

export function runNow(opts: { accountId?: number; full?: boolean } = {}): void {
  void run('manual', { target: opts.accountId ?? null, full: opts.full })
}

export async function fetchMatchNow(matchId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await syncOneMatch(matchId, cloudDetailsSource())
    void cloudSync().catch(() => null)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    void publish()
  }
}

export { publish as publishSyncStatus }
