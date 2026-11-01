import { Link } from '@tanstack/react-router'
import { TimeAgo } from '~/components/ui'
import { useSyncStatus } from '../hooks'

/** Sidebar footer: what sync is doing, and a button to run it now. */
export function SyncWidget() {
  const status = useSyncStatus()
  if (!status) return <div className="h-9" />

  if (!status.steam) {
    return (
      <Link to="/settings" className="flex h-8 items-center justify-center rounded-md bg-accent text-sm font-medium text-white hover:bg-accent-strong">
        Connect Steam
      </Link>
    )
  }

  const running = status.state === 'running'
  const paused = status.backoffUntil !== null
  return (
    <div className="grid gap-2">
      <div className="min-h-8 text-xs leading-4 text-muted">
        {running ? (
          <>
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {status.step ?? 'Syncing'}
              {status.progress && (
                <span className="num text-muted">
                  {status.progress.done + 1}/{status.progress.total}
                </span>
              )}
            </span>
          </>
        ) : status.message ? (
          <span className={status.messageTone === 'error' ? 'text-loss' : status.messageTone === 'warn' ? 'text-ink-2' : ''}>{status.message}</span>
        ) : paused ? (
          <span className="text-ink-2">Steam paused until {new Date(status.backoffUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        ) : status.last ? (
          <>
            Synced <TimeAgo at={status.last.at} />
            {status.last.newMatches > 0 && <> · {status.last.newMatches} new</>}
          </>
        ) : (
          'Not synced yet'
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={running || paused}
          onClick={() => void window.api.sync.run()}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-line text-xs text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className={running ? 'animate-spin' : ''}>
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {running ? 'Syncing…' : 'Sync now'}
        </button>
        <Link to="/settings" title="Settings" className="grid h-7 w-7 place-items-center rounded-md border border-line text-muted hover:border-line-strong hover:text-ink">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
