import type { SyncRunSummary, SyncStatus } from '../../shared/api'
import { broadcast } from '../broadcast'
import { ensureCloudSession } from '../cloud/auth'
import { cloudDetailsSource, cloudPush, cloudSync } from '../cloud/sync'
import { getSteamAccount, hasCliLogin } from '../steam/account'
import { backfillDetails, runSync, refreshFriends, syncOneMatch, waitForDetailRequests, SyncAbort, type SyncOptions } from './engine'
import { backoffFor, backoffUntil, budgetUsed, getState, setState } from './state'

// Steam sync is manual only (the sidebar's Sync now, Settings, a player's
// Sync button, or connecting Steam). Keeping it manual avoids burning Valve's
// undocumented request limit in the background. One status object is mirrored
// to the renderer (sidebar widget, Settings).
//
// Order per click (see engine.ts): match lists GC → community → cloud (D1),
// then match details cloud (D1) → community cache → GC, then push to the
// cloud so the group doesn't download the same things again.

let running = false
let activeRun: Promise<void> | null = null
let friendsRefresh: Promise<void> | null = null
let live: Pick<SyncStatus, 'step' | 'progress' | 'message' | 'messageTone'> = { step: null, progress: null, message: null, messageTone: null }

const toIso = (at: number | null): string | null => (at ? new Date(at).toISOString() : null)

export async function getSyncStatus(): Promise<SyncStatus> {
  const until = await backoffUntil()
  return {
    state: running ? 'running' : 'idle',
    ...live,
    last: await getState<SyncRunSummary>('sync.last'),
    backoffUntil: toIso(until),
    historyBackoffUntil: toIso(await backoffFor('history')),
    detailsBackoffUntil: toIso(await backoffFor('details')),
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
    await ensureCloudSession().catch(() => null)
    try {
      const r = await runSync(opts, cloudDetailsSource(), (p) => {
        live.step = p.step
        live.progress = p.total ? { done: p.done ?? 0, total: p.total } : null
        void publish()
      })
      // Last resort for match lists: the group's cloud copy. A full pull
      // (it also pushes); otherwise just share what this run downloaded.
      live.step = 'Syncing with the cloud'
      live.progress = null
      await publish()
      summary.cloud = await (r.needsCloud.length > 0 ? cloudSync() : cloudPush()).catch(() => null)

      const detailsGot = r.details.cloud + r.details.community + r.details.gc
      Object.assign(summary, {
        newMatches: r.newMatches + (r.needsCloud.length && summary.cloud ? summary.cloud.pulled : 0),
        players: r.players,
        note: r.stoppedBecause ?? (r.errors.length ? r.errors[0] : null),
      })
      const parts = [
        r.stoppedBecause,
        detailsGot ? `${detailsGot} match details (${[r.details.cloud && `${r.details.cloud} cloud`, r.details.community && `${r.details.community} community`, r.details.gc && `${r.details.gc} Steam`].filter(Boolean).join(', ')})` : null,
      ].filter(Boolean)
      live.message = parts.length ? parts.join(' · ') : null
      live.messageTone = r.stoppedBecause ? 'warn' : null
    } catch (err) {
      live.message = err instanceof Error ? err.message : String(err)
      live.messageTone = err instanceof SyncAbort ? 'warn' : 'error'
      summary.note = live.message
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

/**
 * Free-sources details backfill for one player (cloud + community cache, no
 * Steam). Shares the sync status so the sidebar shows progress; skipped
 * while a sync is running (that sync downloads details too).
 */
export function backfillDetailsNow(accountId: number): void {
  if (running || activeRun) return
  const p = (async () => {
    running = true
    live = { step: 'Downloading match details', progress: null, message: null, messageTone: null }
    await publish()
    try {
      const r = await backfillDetails(accountId, cloudDetailsSource(), (prog) => {
        live.step = prog.step
        live.progress = prog.total ? { done: prog.done ?? 0, total: prog.total } : null
        void publish()
      })
      const got = r.cloud + r.community
      live.message = [got ? `${got} match details downloaded (${[r.cloud && `${r.cloud} cloud`, r.community && `${r.community} community`].filter(Boolean).join(', ')})` : null, r.note]
        .filter(Boolean)
        .join(' · ') || null
      live.messageTone = null
      if (got) void cloudPush().catch(() => null)
    } catch (err) {
      live.message = err instanceof Error ? err.message : String(err)
      live.messageTone = 'error'
    } finally {
      running = false
      live.step = null
      live.progress = null
      await publish()
      broadcast('data:changed', null)
    }
  })()
  activeRun = p
  void p.finally(() => {
    if (activeRun === p) activeRun = null
  })
}

export { publish as publishSyncStatus }
