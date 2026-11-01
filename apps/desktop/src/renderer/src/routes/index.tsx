import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { Avatar, Card, RankBadge, TimeAgo } from '~/components/ui'
import { SelfDashboard } from '~/domain/players/components/SelfDashboard'
import { pct } from '@deadlock/core/lib/format'

export const Route = createFileRoute('/')({
  validateSearch: z.object({ q: z.union([z.string(), z.number()]).transform(String).optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [search, friendList, selfId] = await Promise.all([
      deps.q ? window.api.players.search(deps.q) : Promise.resolve(null),
      window.api.players.friends(),
      window.api.players.selfAccountId(),
    ])
    if (search?.kind === 'account') {
      throw redirect({ to: '/players/$accountId', params: { accountId: search.accountId } })
    }
    const overview = deps.q || selfId == null ? null : await window.api.players.overview(selfId)
    return { search, friendList, overview }
  },
  component: Home,
})

const FRIEND_GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_4.5rem_4.5rem]'

function Home() {
  const { search, friendList, overview } = Route.useLoaderData()
  const { friends, withoutMatches } = friendList

  return (
    <div className="grid gap-8">
      {search?.kind === 'invalid' && <p className="text-sm text-loss">That doesn't look like a Steam ID or player name.</p>}
      {search?.kind === 'error' && <p className="text-sm text-loss">Search failed: {search.message}</p>}

      {search?.kind === 'results' && (
        <Card title={`Players matching “${search.query}”`}>
          {search.results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No players found. Try a Steam ID or profile URL instead.</p>
          ) : (
            <ul>
              {search.results.map((r) => (
                <li key={r.accountId} className="border-b border-line last:border-b-0">
                  <Link to="/players/$accountId" params={{ accountId: r.accountId }} className="flex h-11 items-center gap-3 px-4 text-sm hover:bg-surface-2">
                    <Avatar src={r.avatar} name={r.name} size={22} />
                    <span className="flex-1 truncate font-medium">{r.name}</span>
                    <span className="num text-xs text-muted">{r.accountId}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!search &&
        (overview ? (
          <SelfDashboard overview={overview} />
        ) : (
          <div className="card px-6 py-10 text-center">
            <h2 className="text-lg font-medium">Connect Steam to build your dashboard</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">After your first sync, your rank, KDA, top heroes and recent matches show up here.</p>
            <Link to="/settings" className="mt-4 inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong">
              Open settings
            </Link>
          </div>
        ))}

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">Friends</h2>
          {withoutMatches > 0 && <span className="text-xs text-muted">{withoutMatches} without matches hidden</span>}
        </div>
        {friends.length === 0 ? (
          <div className="card px-4 py-8 text-center text-sm text-muted">
            No friends yet. They appear after the first sync — <Link to="/settings" className="text-ink-2 underline">connect Steam</Link> if you haven't.
          </div>
        ) : (
          <div className="card">
            <div className={`${FRIEND_GRID} border-b border-line px-4 py-2 text-xs text-muted`}>
              <span>Player</span>
              <span className="hidden sm:block">Rank</span>
              <span className="text-right">Games</span>
              <span className="text-right">Win rate</span>
              <span className="hidden text-right sm:block">Last match</span>
              <span className="hidden text-right sm:block">Last sync</span>
            </div>
            <ul>
              {friends.map((f) => (
                <li key={f.accountId} className="border-b border-line last:border-b-0">
                  <Link to="/players/$accountId" params={{ accountId: f.accountId }} className={`${FRIEND_GRID} h-11 px-4 text-sm hover:bg-surface-2`}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar src={f.avatar} name={f.name} size={22} />
                      <span className="truncate font-medium">{f.name}</span>
                    </span>
                    <span className="hidden truncate sm:block">
                      <RankBadge rank={f.rank} size={16} />
                    </span>
                    <span className="num text-right text-ink-2">{f.games}</span>
                    <span className={`num text-right ${f.wins / f.games >= 0.5 ? 'text-win' : 'text-loss'}`}>{pct(f.wins, f.games)}</span>
                    <TimeAgo at={f.lastMatchAt == null ? null : f.lastMatchAt * 1000} className="hidden text-right text-xs text-muted sm:block" />
                    <TimeAgo at={f.lastSyncedAt} className="hidden text-right text-xs text-muted sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
