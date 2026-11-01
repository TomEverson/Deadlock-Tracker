import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { TimeAgo } from '~/components/ui'
import { AccountPanel } from '~/domain/sync/components/AccountPanel'
import { SteamConnect } from '~/domain/sync/components/SteamConnect'
import { useSyncStatus } from '~/domain/sync/hooks'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** Informational only: Steam sets the real limit and doesn't publish it. */
function RequestUsage({ label, used }: { label: string; used: number }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-2">{label}</span>
      <span className="num text-muted">{used} in the last 24h</span>
    </div>
  )
}

const button = 'h-8 rounded-md border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50'

function SettingsPage() {
  const status = useSyncStatus()

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="card px-5 py-6">
        <Section
          title="Account"
          description="Your Steam account reads match data from Deadlock's servers and signs you in to the cloud shared with your friends. The app always works offline; the cloud is a shared cache and backup."
        >
          {!status ? null : status.steam ? <AccountPanel steam={status.steam} /> : <SteamConnect />}
        </Section>

        <Section
          title="Sync"
          description="Syncs only when you ask: Sync now, a player's Sync button, or right after connecting Steam. Each run reads match histories only; a match's details are downloaded when you open it. Automatic syncing stays off to keep Steam requests well under its limit."
        >
          {status && (
            <div className="grid gap-4">
              <div className="text-sm">
                {status.state === 'running' ? (
                  <span className="text-ink">
                    {status.step}
                    {status.progress && ` · ${status.progress.done + 1}/${status.progress.total}`}
                  </span>
                ) : status.last ? (
                  <span className="text-ink-2">
                    Last sync <TimeAgo at={status.last.at} /> · {status.last.newMatches} new matches
                  </span>
                ) : (
                  <span className="text-muted">Not synced yet.</span>
                )}
                {status.message && <p className={`mt-1 text-xs ${status.messageTone === 'error' ? 'text-loss' : 'text-muted'}`}>{status.message}</p>}
                {status.backoffUntil && !status.message && (
                  <p className="mt-1 text-xs text-muted">
                    Steam requests paused until {new Date(status.backoffUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                  </p>
                )}
              </div>
              <div className="grid max-w-md gap-2">
                <RequestUsage label="Match history requests" used={status.budgets.history.used} />
                <RequestUsage label="Match detail requests" used={status.budgets.details.used} />
                <p className="text-xs text-muted">Steam decides the actual limit and doesn't publish it; the app stops when Steam asks it to slow down.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={!status.steam || status.state === 'running' || status.backoffUntil !== null}
                  onClick={() => void window.api.sync.run()}
                >
                  Sync now
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={!status.steam || status.state === 'running' || status.backoffUntil !== null}
                  title="Re-reads every match history from the start. Uses more Steam requests."
                  onClick={() => void window.api.sync.run({ full: true })}
                >
                  Full resync
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
