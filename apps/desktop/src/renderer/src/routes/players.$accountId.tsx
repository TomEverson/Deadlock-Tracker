import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { TabBar, tabClass } from '~/components/ui'
import { HeroTable } from '~/domain/players/components/HeroTable'
import { MatchList } from '~/domain/players/components/MatchList'
import { MatesPanel } from '~/domain/players/components/MatesPanel'
import { PlayerAnalysis } from '~/domain/players/components/PlayerAnalysis'
import { PlayerHeader } from '~/domain/players/components/PlayerHeader'
import { SummaryStrip } from '~/domain/players/components/SummaryStrip'
import { accountIdSchema } from '@deadlock/core/domain/players/validators/player-input'
import { SyncStatus } from '~/domain/sync/components/SyncStatus'

export const Route = createFileRoute('/players/$accountId')({
  params: {
    parse: (raw) => {
      const parsed = accountIdSchema.safeParse(raw.accountId)
      if (!parsed.success) throw notFound()
      return { accountId: parsed.data }
    },
    stringify: ({ accountId }) => ({ accountId: String(accountId) }),
  },
  validateSearch: z.object({ tab: z.enum(['matches', 'analysis', 'heroes', 'teammates']).optional().catch(undefined) }),
  // The analysis runs analyzeMatch over every stored match, so only load it on its tab.
  loaderDeps: ({ search }) => ({ analysis: search.tab === 'analysis' }),
  loader: async ({ params, deps }) => {
    const [overview, mates, self, analysis] = await Promise.all([
      window.api.players.overview(params.accountId),
      window.api.players.mates(params.accountId),
      window.api.players.selfAccountId(),
      deps.analysis ? window.api.players.analysis(params.accountId) : Promise.resolve(null),
    ])
    return { overview, mates, isSelf: self === params.accountId, analysis }
  },
  component: PlayerPage,
})

type Tab = 'matches' | 'analysis' | 'heroes' | 'teammates'

function PlayerPage() {
  const { overview, mates, isSelf, analysis } = Route.useLoaderData()
  const { tab = 'matches' } = Route.useSearch()
  const { profile, rank, freshness, summary, heroes, matches, totalMatches } = overview
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'matches', label: 'Matches', count: totalMatches },
    { id: 'analysis', label: 'Analysis' },
    { id: 'heroes', label: 'Heroes', count: heroes.length },
    { id: 'teammates', label: 'Teammates' },
  ]

  return (
    <div className="grid gap-6">
      <PlayerHeader profile={profile} rank={rank} actions={<SyncStatus accountId={profile.accountId} freshness={freshness} isSelf={isSelf} />} />
      <SummaryStrip summary={summary} />
      <div className="grid gap-4">
        <TabBar>
          {tabs.map((t) => (
            <Link key={t.id} to="." search={{ tab: t.id === 'matches' ? undefined : t.id }} replace resetScroll={false} role="tab" aria-selected={tab === t.id} className={tabClass(tab === t.id)}>
              {t.label}
              {t.count != null && <span className="num text-xs text-muted">{t.count}</span>}
            </Link>
          ))}
        </TabBar>
        {tab === 'matches' && <MatchList accountId={profile.accountId} matches={matches} />}
        {tab === 'analysis' && analysis && <PlayerAnalysis analysis={analysis} accountId={profile.accountId} />}
        {tab === 'heroes' && <HeroTable heroes={heroes} />}
        {tab === 'teammates' && <MatesPanel mates={mates.mates} unavailable={mates.kind === 'unavailable'} />}
      </div>
    </div>
  )
}
