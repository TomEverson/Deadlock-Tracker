import { createFileRoute, Link } from '@tanstack/react-router'
import { PlayerAnalysis } from '~/domain/players/components/PlayerAnalysis'

// Your own cross-match analysis, as its own section (friends' analysis is a
// tab on their player page).
export const Route = createFileRoute('/analysis')({
  loader: async () => {
    const self = await window.api.players.selfAccountId()
    return { self, analysis: self ? await window.api.players.analysis(self) : null }
  },
  component: AnalysisPage,
})

function AnalysisPage() {
  const { self, analysis } = Route.useLoaderData()
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="text-sm text-muted">Your habits, what wins your games, and how you're trending.</p>
      </header>
      {self && analysis ? (
        <PlayerAnalysis analysis={analysis} accountId={self} />
      ) : (
        <p className="text-sm text-ink-2">
          Connect Steam in{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Settings
          </Link>{' '}
          and sync to build your analysis.
        </p>
      )}
    </div>
  )
}
