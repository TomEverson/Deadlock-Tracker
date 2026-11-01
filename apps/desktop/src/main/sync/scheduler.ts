import type { SyncRunSummary, SyncStatus } from '../../shared/api'
import { broadcast } from '../broadcast'
import { ensureCloudSession } from '../cloud/auth'
import { cloudDetailsSource, cloudSync } from '../cloud/sync'
import { getSteamAccount, hasCliLogin } from '../steam/account'
import { runSync, refreshFriends, syncOneMatch, waitForDetailRequests, SyncAbort, type SyncOptions } from './engine'
import { backoffUntil, budgetUsed, getState, setState } from './state'

// Steam sync is manual only (the sidebar's Sync now, Settings, a player's
// Sync button, or connecting Steam). Keeping it manual avoids burning Valve's
// undocumented request limit in the background. One status object is mirrored
// to the renderer (sidebar widget, Settings).

let running = false
let activeRun: Promise<void> | null = null
let friendsRefresh: Promise<void> | null = null
let live: Pick<SyncStatus, 'step' | 'progress' | 'message' | 'messageTone'> = { step: null, progress: null, message: null, messageTone: null }

export async function getSyncStatus(): Promise<SyncStatus> {
  const until = await backoffUntil()
  return {
    state: running ? 'running' : 'idle',
    ...live,
    last: await getState<SyncRunSummary>('sync.last'),
    backoffUntil: until ? new Date(until).toISOString() : null,
    budgets: {
      history: { used: await budgetUsed('history') },
      details: { used: await budgetUsed('details') },
    },
    steam: await getSteamAccount(),
    hasCliLogin: hasCliLogin(),
  }
}

async function publish(): Promise<void> {
  broadcast('sync:status', await getSyncStatus())
}

async function run(trigger: 'auto' | 'manual', opts: SyncOptions = {}): Promise<void> {
  if (running) return
  running = true
  live = { step: 'Starting', progress: null, message: null, messageTone: null }
  await publish()
  const summary: SyncRunSummary = { at: new Date().toISOString(), trigger, newMatches: 0, players: 0, cloud: null, note: null }
  try {
    // A launch friend refresh or an on-demand match download may still be
    // using the Steam account; don't open a second session on top of it.
    if (friendsRefresh) await friendsRefresh
    await waitForDetailRequests()
    // Pull first so other installs' data (and match details) are here before we ask Steam.
    live.step = 'Syncing with the cloud'
    await publish()
    await ensureCloudSession().catch(() => null)
    summary.cloud = await cloudSync().catch(() => null)

    if (await getSteamAccount()) {
      try {
        const r = await runSync(opts, (p) => {
          live.step = p.step
          live.progress = p.total ? { done: p.done ?? 0, total: p.total } : null
          void publish()
        })
        Object.assign(summary, {
          newMatches: r.newMatches,
          players: r.players,
          note: r.stoppedBecause ?? (r.errors.length ? r.errors[0] : null),
        })
        live.message = r.stoppedBecause
        live.messageTone = r.stoppedBecause ? 'warn' : null
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

export function runNow(opts: { accountId?: number; full?: boolean } = {}): void {
  if (activeRun) return
  const p = run('manual', { target: opts.accountId ?? null, full: opts.full })
  activeRun = p
  void p
    .finally(() => {
      if (activeRun === p) activeRun = null
    })
    .catch(() => {})
}

/**
 * On app launch, refresh just the friend list and personas. This uses the
 * normal Steam connection (no Game Coordinator requests), so it doesn't touch
 * the match-history/detail rate limits. Silent on failure: a manual Sync still
 * reloads the list.
 */
export function refreshFriendsNow(): void {
  if (running || friendsRefresh) return
  friendsRefresh = refreshFriends()
    .then(() => {
      broadcast('data:changed', null)
    })
    .catch(() => {})
    .finally(() => {
      friendsRefresh = null
    })
}

export async function fetchMatchNow(matchId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  // Don't open a second Steam session while a full sync or the launch friend
  // refresh is using the account; Steam treats overlapping logons as contention.
  if (activeRun) await activeRun.catch(() => {})
  if (friendsRefresh) await friendsRefresh.catch(() => {})
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
