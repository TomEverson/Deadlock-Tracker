import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { HeroIcon, ResultDot, Segmented, useIsClient } from '~/components/ui'
import { formatDuration, formatSouls, kdaRatio } from '@deadlock/core/lib/format'
import type { PlayerMatchRow } from '@deadlock/core/domain/players/types'

const PAGE = 50
type ResultFilter = 'all' | 'wins' | 'losses'

const ROW_GRID = 'grid grid-cols-[3.5rem_1.75rem_minmax(0,1fr)_5.5rem_3.5rem] items-center gap-3 sm:grid-cols-[3.5rem_1.75rem_minmax(0,1fr)_5.5rem_3rem_3.5rem_3rem_3.5rem_4rem]'

/** Day key + label. Uses the viewer's timezone once hydrated (UTC on the server). */
function dayOf(startTime: number, local: boolean): { key: string; label: string } {
  const d = new Date(startTime * 1000)
  const parts = local
    ? { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() }
    : { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() }
  const key = `${parts.y}-${parts.m}-${parts.day}`
  if (!local) return { key, label: d.toLocaleDateString('en', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) }
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const same = (a: Date) => a.getFullYear() === parts.y && a.getMonth() === parts.m && a.getDate() === parts.day
  const label = same(today) ? 'Today' : same(yesterday) ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return { key, label }
}

function timeOf(startTime: number, local: boolean): string {
  const d = new Date(startTime * 1000)
  return local ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleTimeString('en', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
}

export function MatchList({ accountId, matches, compact = false }: { accountId: number; matches: PlayerMatchRow[]; compact?: boolean }) {
  const [shown, setShown] = useState(PAGE)
  const [result, setResult] = useState<ResultFilter>('all')
  const [heroId, setHeroId] = useState<number | 'all'>('all')
  const local = useIsClient()

  const heroOptions = [...new Map(matches.map((m) => [m.hero.id, m.hero])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const filtered = matches.filter(
    (m) => (result === 'all' || (result === 'wins' ? m.won : !m.won)) && (heroId === 'all' || m.hero.id === heroId),
  )
  const visible = filtered.slice(0, shown)

  const groups: { key: string; label: string; rows: PlayerMatchRow[] }[] = []
  for (const m of visible) {
    const { key, label } = dayOf(m.startTime, local)
    const last = groups.at(-1)
    if (last?.key === key) last.rows.push(m)
    else groups.push({ key, label, rows: [m] })
  }

  return (
    <div className="grid gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ResultFilter>
            value={result}
            onChange={(v) => {
              setResult(v)
              setShown(PAGE)
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'wins', label: 'Wins' },
              { value: 'losses', label: 'Losses' },
            ]}
          />
          <select
            value={heroId}
            onChange={(e) => {
              setHeroId(e.target.value === 'all' ? 'all' : Number(e.target.value))
              setShown(PAGE)
            }}
            aria-label="Filter by hero"
            className="h-7 rounded-md border border-line bg-surface px-2 text-xs text-ink-2 hover:border-line-strong focus:outline-none"
          >
            <option value="all">All heroes</option>
            {heroOptions.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className="num ml-auto text-xs text-muted">
            {filtered.length} match{filtered.length === 1 ? '' : 'es'}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card px-4 py-10 text-center text-sm text-muted">{matches.length === 0 ? 'No matches stored for this player yet.' : 'No matches match these filters.'}</div>
      ) : (
        <div className="card">
          <div className={`${ROW_GRID} border-b border-line px-4 py-2 text-xs text-muted`}>
            <span>Result</span>
            <span />
            <span>Hero</span>
            <span className="text-right">K / D / A</span>
            <span className="hidden text-right sm:block">KDA</span>
            <span className="hidden text-right sm:block">Souls</span>
            <span className="hidden text-right sm:block">LH</span>
            <span className="text-right">Length</span>
            <span className="hidden text-right sm:block">Time</span>
          </div>
          {groups.map((g) => {
            const wins = g.rows.filter((r) => r.won).length
            return (
              <section key={g.key}>
                <div className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-1.5 text-xs">
                  <span className="font-medium text-ink-2" suppressHydrationWarning>
                    {g.label}
                  </span>
                  <span className="num text-muted">
                    {wins}W {g.rows.length - wins}L
                  </span>
                </div>
                <ul>
                  {g.rows.map((m) => (
                    <li key={m.matchId} className="border-b border-line last:border-b-0">
                      <Link
                        to="/matches/$matchId"
                        params={{ matchId: m.matchId }}
                        search={{ player: accountId }}
                        className={`${ROW_GRID} h-11 px-4 text-sm hover:bg-surface-2`}
                      >
                        <span className={`flex items-center gap-2 font-medium ${m.abandoned ? 'text-muted' : m.won ? 'text-win' : 'text-loss'}`}>
                          <ResultDot won={m.won} abandoned={m.abandoned} />
                          {m.abandoned ? 'Left' : m.won ? 'Win' : 'Loss'}
                        </span>
                        <HeroIcon hero={m.hero} size={28} />
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate font-medium text-ink">{m.hero.name}</span>
                          <span className="hidden truncate text-xs text-muted sm:inline">{m.mode}</span>
                        </span>
                        <span className="num text-right">
                          {m.kills}
                          <span className="text-muted"> / </span>
                          {m.deaths}
                          <span className="text-muted"> / </span>
                          {m.assists}
                        </span>
                        <span className="num hidden text-right text-ink-2 sm:block">{kdaRatio(m.kills, m.deaths, m.assists)}</span>
                        <span className="num hidden text-right text-ink-2 sm:block">{formatSouls(m.netWorth)}</span>
                        <span className="num hidden text-right text-ink-2 sm:block">{m.lastHits}</span>
                        <span className="num text-right text-ink-2">{formatDuration(m.durationS)}</span>
                        <span className="num hidden text-right text-xs text-muted sm:block" suppressHydrationWarning>
                          {timeOf(m.startTime, local)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {!compact && shown < filtered.length && (
            <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full border-t border-line py-2.5 text-xs text-muted hover:bg-surface-2 hover:text-ink">
              Show more · {filtered.length - shown} left
            </button>
          )}
        </div>
      )}
    </div>
  )
}
