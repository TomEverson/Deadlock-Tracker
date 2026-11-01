import { useEffect, useState } from 'react'
import { TimeAgo } from '~/components/ui'
import type { CloudStatus, SteamAccount } from '../../../../../shared/api'

const button = 'h-8 rounded-md border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50'

/**
 * Settings → Account (once Steam is connected). One Steam login covers both:
 * reading matches from Deadlock's servers and the shared cloud.
 */
export function AccountPanel({ steam }: { steam: SteamAccount }) {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [retrying, setRetrying] = useState(false)
  const refresh = () => void window.api.cloud.status().then(setStatus)

  useEffect(() => {
    refresh()
    return window.api.on('data:changed', refresh)
  }, [])

  const cloud = status?.account
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{steam.name ?? status?.account?.name ?? 'Steam account'}</div>
          <div className="num text-xs text-muted">Account ID {steam.accountId}</div>
        </div>
        <button type="button" className={button} title="Disconnects Steam and signs out of the cloud" onClick={() => void window.api.steam.disconnect()}>
          Disconnect
        </button>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-win" aria-hidden />
          <dt className="w-28 shrink-0 text-ink-2">Match sync</dt>
          <dd className="text-muted">Connected</dd>
        </div>
        <div className="flex items-start gap-2.5">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cloud ? 'bg-win' : status?.signIn ? 'bg-loss' : 'bg-muted'}`} aria-hidden />
          <dt className="w-28 shrink-0 text-ink-2">Shared cloud</dt>
          <dd className="min-w-0 flex-1 text-muted">
            {!status ? null : cloud ? (
              <>
                On
                {status.lastSync &&
                  (status.lastSync.error ? (
                    <span className="text-loss"> · last sync failed: {status.lastSync.error}</span>
                  ) : (
                    <>
                      {' '}
                      · synced <TimeAgo at={status.lastSync.at} />
                    </>
                  ))}
                {status.pending > 0 && <> · {status.pending} changes to upload</>}
              </>
            ) : (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={status.signIn ? 'text-ink-2' : ''}>
                  {status.signIn?.kind === 'error'
                    ? `Couldn't connect: ${status.signIn.message}`
                    : retrying
                      ? 'Connecting…'
                      : 'Connects automatically on the next sync.'}
                </span>
                <button
                  type="button"
                  disabled={retrying}
                  className="text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
                  onClick={() => {
                    setRetrying(true)
                    void window.api.cloud.signIn().finally(() => {
                      setRetrying(false)
                      refresh()
                    })
                  }}
                >
                  {retrying ? 'Connecting…' : 'Retry'}
                </button>
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
