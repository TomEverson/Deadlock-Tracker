import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { TimeAgo } from '~/components/ui'
import { AccountPanel } from '~/domain/sync/components/AccountPanel'
import { SteamConnect } from '~/domain/sync/components/SteamConnect'
import { useSyncStatus } from '~/domain/sync/hooks'

export const Route = createFileRoute('/settings')({
  loader: () => window.api.data.legacyStatus(),
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

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="num text-muted">
          {used} / {limit} today
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${used >= limit ? 'bg-loss' : 'bg-accent'}`} style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
      </div>
    </div>
  )
}

const button = 'h-8 rounded-md border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50'

function SettingsPage() {
  const legacy = Route.useLoaderData()
  const status = useSyncStatus()
  const router = useRouter()
  const [imported, setImported] = useState<string | null>(null)

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

        <Section title="Sync" description="Runs when the app opens and every 30 minutes. Steam limits how often match data can be read, so big backlogs fill in over a few days.">
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
                    Last sync <TimeAgo at={status.last.at} /> · {status.last.newMatches} new matches · {status.last.detailsFetched + status.last.detailsFromCloud} match details
                    {status.last.detailsFromCloud > 0 && ` (${status.last.detailsFromCloud} from the cloud)`}
                    {status.last.detailsRemaining > 0 && ` · ${status.last.detailsRemaining} still to download`}
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
              <div className="grid max-w-md gap-3">
                <Meter label="Match history requests" used={status.budgets.history.used} limit={status.budgets.history.limit} />
                <Meter label="Match detail requests" used={status.budgets.details.used} limit={status.budgets.details.limit} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} disabled={!status.steam || status.state === 'running'} onClick={() => void window.api.sync.run()}>
                  Sync now
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={!status.steam || status.state === 'running'}
                  title="Re-reads every match history from the start. Uses more Steam requests."
                  onClick={() => void window.api.sync.run({ full: true })}
                >
                  Full resync
                </button>
              </div>
            </div>
          )}
        </Section>

        {legacy.found && (
          <Section title="Previous version" description="Bring over matches and details stored by the old web version (saved in ~/.deadlock-tracker).">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={button}
                onClick={() =>
                  void window.api.data.importLegacy().then((r) => {
                    setImported(`Imported ${r.matches} matches, ${r.details} match details, ${r.players} players.`)
                    void router.invalidate()
                  })
                }
              >
                Import again
              </button>
              {imported && <span className="text-xs text-muted">{imported}</span>}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
