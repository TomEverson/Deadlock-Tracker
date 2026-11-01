import { createFileRoute, Link } from '@tanstack/react-router'
import { MatchList } from '~/domain/players/components/MatchList'
import { SummaryStrip } from '~/domain/players/components/SummaryStrip'

// Your own match history as its own section.
export const Route = createFileRoute('/matches/')({
  loader: async () => {
    const self = await window.api.players.selfAccountId()
    return { self, overview: self ? await window.api.players.overview(self) : null }
  },
  component: MatchesPage,
})

function MatchesPage() {
  const { self, overview } = Route.useLoaderData()
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Matches</h1>
        {overview && <p className="num text-sm text-muted">{overview.totalMatches} games</p>}
      </header>
      {self && overview ? (
        <>
          <SummaryStrip summary={overview.summary} />
          <MatchList accountId={self} matches={overview.matches} />
        </>
      ) : (
        <p className="text-sm text-ink-2">
          Connect Steam in{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Settings
          </Link>{' '}
          and sync to see your matches.
        </p>
      )}
    </div>
  )
}
