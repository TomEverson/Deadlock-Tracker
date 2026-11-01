import { useEffect, useState } from 'react'
import { TimeAgo } from '~/components/ui'
import type { AllowlistEntry } from '@deadlock/core/sync/protocol'
import type { CloudStatus, SteamAccount } from '../../../../../shared/api'

const button = 'h-8 rounded-md border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50'
const inputClass = 'h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted focus:border-line-strong focus:outline-none'

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
                On · {cloud.role === 'admin' ? 'Admin' : 'Member'}
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
                  {status.signIn?.kind === 'not-allowed'
                    ? `Not allowed yet — send your account ID ${steam.accountId} to the admin.`
                    : status.signIn?.kind === 'error'
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

      {cloud?.role === 'admin' && <Allowlist self={cloud.accountId} />}
    </div>
  )
}

function Allowlist({ self }: { self: number }) {
  const [entries, setEntries] = useState<AllowlistEntry[] | null>(null)
  const [who, setWho] = useState('')
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    void window.api.cloud
      .allowlist()
      .then(setEntries)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))

  useEffect(load, [])

  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-ink-2">Who can sign in</div>
      <div className="card divide-y divide-line">
        {(entries ?? []).map((e) => (
          <div key={e.accountId} className="flex h-10 items-center gap-3 px-3 text-sm">
            <span className="num flex-1">{e.accountId}</span>
            <span className="text-xs text-muted">{e.role === 'admin' ? 'Admin' : 'Member'}</span>
            {e.accountId !== self && (
              <button
                type="button"
                className="text-xs text-muted hover:text-loss"
                onClick={() => void window.api.cloud.revoke(e.accountId).then((r) => (r.ok ? load() : setError(r.message)))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          setError(null)
          void window.api.cloud.allow(who, 'member').then((r) => {
            if (r.ok) {
              setWho('')
              load()
            } else setError(r.message)
          })
        }}
      >
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Friend's account ID, SteamID64 or profile URL" className={inputClass} />
        <button type="submit" disabled={!who.trim()} className={button}>
          Allow
        </button>
      </form>
      {error && <p className="text-xs text-loss">{error}</p>}
    </div>
  )
}
