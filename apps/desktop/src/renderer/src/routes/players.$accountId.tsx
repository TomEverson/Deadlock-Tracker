import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { TabBar, tabClass } from '~/components/ui'
import { HeroTable } from '~/domain/players/components/HeroTable'
import { MatchList } from '~/domain/players/components/MatchList'
import { MatesPanel } from '~/domain/players/components/MatesPanel'
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
  validateSearch: z.object({ tab: z.enum(['matches', 'heroes', 'teammates']).optional() }),
  loader: async ({ params }) => {
    const [overview, mates, self] = await Promise.all([
      window.api.players.overview(params.accountId),
      window.api.players.mates(params.accountId),
      window.api.players.selfAccountId(),
    ])
    return { overview, mates, isSelf: self === params.accountId }
  },
  component: PlayerPage,
})

type Tab = 'matches' | 'heroes' | 'teammates'

function PlayerPage() {
  const { overview, mates, isSelf } = Route.useLoaderData()
  const { tab = 'matches' } = Route.useSearch()
  const { profile, rank, freshness, summary, heroes, matches, totalMatches } = overview
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'matches', label: 'Matches', count: totalMatches },
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
        {tab === 'heroes' && <HeroTable heroes={heroes} />}
        {tab === 'teammates' && <MatesPanel mates={mates.mates} unavailable={mates.kind === 'unavailable'} />}
      </div>
    </div>
  )
}
