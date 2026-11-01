import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Avatar, Card, RankBadge, TimeAgo } from '~/components/ui'
import { SearchForm } from '~/domain/players/components/SearchForm'
import { pct } from '@deadlock/core/lib/format'

export const Route = createFileRoute('/')({
  validateSearch: z.object({ q: z.union([z.string(), z.number()]).transform(String).optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [search, friendList, legacy] = await Promise.all([
      deps.q ? window.api.players.search(deps.q) : Promise.resolve(null),
      window.api.players.friends(),
      window.api.data.legacyStatus(),
    ])
    if (search?.kind === 'account') {
      throw redirect({ to: '/players/$accountId', params: { accountId: search.accountId } })
    }
    return { search, friendList, legacy }
  },
  component: Home,
})

const FRIEND_GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_3.5rem_3.5rem_5rem]'

function Home() {
  const { search, friendList, legacy } = Route.useLoaderData()
  const { q } = Route.useSearch()
  const { self, friends, withoutMatches } = friendList

  return (
    <div className="grid gap-8">
      <header className="grid gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <SearchForm initial={q ?? ''} key={q ?? ''} large />
        {search?.kind === 'invalid' && <p className="text-sm text-loss">That doesn't look like a Steam ID or player name.</p>}
        {search?.kind === 'error' && <p className="text-sm text-loss">Search failed: {search.message}</p>}
      </header>

      {legacy.found && !legacy.hasData && <ImportCard />}

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

      {self && (
        <section className="grid gap-2">
          <h2 className="label">You</h2>
          <Link to="/players/$accountId" params={{ accountId: self.accountId }} className="card flex items-center gap-3.5 px-4 py-3 hover:border-line-strong">
            <Avatar src={self.avatar} name={self.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{self.name}</div>
              <div className="text-xs text-muted">
                Last match <TimeAgo at={self.lastMatchAt == null ? null : self.lastMatchAt * 1000} />
              </div>
            </div>
            <div className="hidden sm:block">
              <RankBadge rank={self.rank} size={18} />
            </div>
            <div className="num w-20 text-right text-sm">
              <div>{self.games} games</div>
              {self.games > 0 && <div className={self.wins / self.games >= 0.5 ? 'text-win' : 'text-loss'}>{pct(self.wins, self.games)}</div>}
            </div>
          </Link>
        </section>
      )}

      <section className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="label">Friends</h2>
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

/** First launch: bring over everything the previous version had stored. */
function ImportCard() {
  const router = useRouter()
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  return (
    <div className="card flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">Import your existing data</div>
        <div className="text-xs text-muted">
          {state.kind === 'error' ? <span className="text-loss">{state.message}</span> : 'Matches, match details and friends from the previous version. Nothing is downloaded again.'}
        </div>
      </div>
      <button
        type="button"
        disabled={state.kind === 'busy'}
        onClick={() => {
          setState({ kind: 'busy' })
          window.api.data
            .importLegacy()
            .then(() => router.invalidate())
            .catch((err: unknown) => setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }))
        }}
        className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {state.kind === 'busy' ? 'Importing…' : 'Import'}
      </button>
    </div>
  )
}
