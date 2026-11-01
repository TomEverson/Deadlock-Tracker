import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Avatar, HeroIcon, RankBadge, TimeAgo } from '~/components/ui'
import { formatDuration, formatSouls, kdaRatio, pct } from '@deadlock/core/lib/format'
import type { HeroStatRow, PlayerOverview } from '@deadlock/core/domain/players/types'
import { MatchList } from './MatchList'

/** Home's personal dashboard: rank, headline stats, top heroes and recent games. */
export function SelfDashboard({ overview }: { overview: PlayerOverview }) {
  const { profile, rank, freshness, summary, heroes, matches, totalMatches } = overview
  const average = (n: number) => (n / Math.max(1, summary.games)).toFixed(1)
  const recentWins = summary.recentForm.filter(Boolean).length
  const recentLosses = summary.recentForm.length - recentWins
  const topHeroes = heroes.slice(0, 5)

  return (
    <div className="grid gap-6">
      <section className="card relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 140% at 0% 0%, var(--color-accent-bg), transparent 55%)' }}
        />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar src={profile.avatar} name={profile.name} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{profile.name}</h1>
                <span className="inline-flex items-center rounded-full border border-line bg-surface-2/60 px-2.5 py-1">
                  <RankBadge rank={rank} size={24} />
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="num">ID {profile.accountId}</span>
                {profile.profileUrl && (
                  <a href={profile.profileUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
                    Steam profile ↗
                  </a>
                )}
                <span>
                  Synced <TimeAgo at={freshness.lastSyncedAt} />
                </span>
                {freshness.latestMatchAt != null && (
                  <span>
                    Last match <TimeAgo at={freshness.latestMatchAt * 1000} />
                  </span>
                )}
              </div>
              <Link
                to="/players/$accountId"
                params={{ accountId: profile.accountId }}
                className="mt-2 inline-block text-xs text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                Full profile →
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-5 lg:justify-end">
            <WinRateRing wins={summary.wins} games={summary.games} />
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <BigStat
                label="KDA"
                value={kdaRatio(summary.kills, summary.deaths, summary.assists)}
                sub={`${average(summary.kills)} / ${average(summary.deaths)} / ${average(summary.assists)}`}
              />
              <BigStat label="Avg souls" value={formatSouls(summary.avgNetWorth)} sub="per game" />
              <BigStat
                label="Matches"
                value={summary.games}
                sub={summary.games > 0 ? `${formatDuration(summary.avgDurationS)} avg` : 'No games yet'}
              />
              <BigStat
                label="Last 10"
                value={summary.recentForm.length > 0 ? `${recentWins}W ${recentLosses}L` : '—'}
                sub={<FormBars form={summary.recentForm} />}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">Top heroes</h2>
          <Link
            to="/players/$accountId"
            params={{ accountId: profile.accountId }}
            search={{ tab: 'heroes' }}
            className="text-xs text-muted hover:text-ink"
          >
            View all
          </Link>
        </div>
        <TopHeroes heroes={topHeroes} accountId={profile.accountId} />
      </section>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">Recent matches</h2>
          <Link to="/players/$accountId" params={{ accountId: profile.accountId }} className="text-xs text-muted hover:text-ink">
            View all {totalMatches}
          </Link>
        </div>
        <MatchList accountId={profile.accountId} matches={matches.slice(0, 10)} compact />
      </section>
    </div>
  )
}

function BigStat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="num text-xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="label">{label}</div>
      <div className="num min-h-4 text-xs text-muted">{sub}</div>
    </div>
  )
}

function WinRateRing({ wins, games }: { wins: number; games: number }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const ratio = games > 0 ? wins / games : 0
  const tone = ratio >= 0.5 ? 'text-win' : 'text-loss'
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--color-surface-2)" strokeWidth="5" />
          {games > 0 && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={ratio >= 0.5 ? 'var(--color-win)' : 'var(--color-loss)'}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${circumference * ratio} ${circumference}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={`num text-xl font-semibold ${games > 0 ? tone : 'text-muted'}`}>{pct(wins, games)}</span>
        </div>
      </div>
      <div className="label mt-1">Win rate</div>
      <div className="num text-xs text-muted">
        {wins}W {Math.max(0, games - wins)}L
      </div>
    </div>
  )
}

function FormBars({ form }: { form: boolean[] }) {
  if (form.length === 0) return <span>No games yet</span>
  return (
    <span className="mt-1 flex h-3.5 items-end gap-1">
      {[...form].reverse().map((won, i) => (
        <span key={i} title={won ? 'Win' : 'Loss'} className={`h-full w-1.5 rounded-sm ${won ? 'bg-win' : 'bg-loss'}`} />
      ))}
    </span>
  )
}

function TopHeroes({ heroes, accountId }: { heroes: HeroStatRow[]; accountId: number }) {
  if (heroes.length === 0) {
    return <div className="card px-4 py-8 text-center text-sm text-muted">No hero stats yet — press Sync now.</div>
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {heroes.map((h) => {
        const winRate = h.wins / Math.max(1, h.games)
        return (
          <Link
            key={h.hero.id}
            to="/players/$accountId"
            params={{ accountId }}
            search={{ tab: 'heroes' }}
            className="card p-3 transition-colors hover:border-line-strong"
          >
            <div className="flex items-center gap-2.5">
              <HeroIcon hero={h.hero} size={44} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{h.hero.name}</div>
                <div className="num text-xs text-muted">{h.games} games</div>
              </div>
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <span className={`num text-lg font-semibold ${winRate >= 0.5 ? 'text-win' : 'text-loss'}`}>{pct(h.wins, h.games)}</span>
              <span className="num text-xs text-muted">{kdaRatio(h.kills, h.deaths, h.assists)} KDA</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
              <span className={`block h-full rounded-full ${winRate >= 0.5 ? 'bg-win' : 'bg-loss'}`} style={{ width: `${winRate * 100}%` }} />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
