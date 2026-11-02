import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Card, Segmented } from '~/components/ui'
import { useSyncStatus } from '~/domain/sync/hooks'
import type { Habit, OverallAnalysis, PeriodStat, PlayerAnalysisResult, TrendPoint, WinCondition } from '@deadlock/core/domain/players/services/overall-analysis'
import type { HeroCoachingResult } from '@deadlock/core/domain/players/services/hero-coaching'
import { HeroIcon } from '~/components/ui'
import { benchmarkText, crossHeroPatterns } from './HeroCoachingView'
import { HeroesSection } from './HeroesSection'
import { DeathsSection } from './DeathsSection'

type Section = 'summary' | 'heroes' | 'deaths' | 'conditions' | 'trends'

const pct = (x: number) => `${Math.round(x * 100)}%`

// ------------------------------------------------------------------ coverage

// Accounts whose free backfill already ran this app session: matches the
// cloud and community cache don't have would otherwise re-trigger it on every reload.
const backfilled = new Set<number>()

function Coverage({ analysis, accountId }: { analysis: OverallAnalysis; accountId: number }) {
  const status = useSyncStatus()
  const running = status?.state === 'running'
  const missing = analysis.totalGames - analysis.analyzedGames

  // Opening the analysis fills in previous games' details from free sources
  // (cloud, community cache); the page reloads itself when they land.
  useEffect(() => {
    if (missing === 0 || backfilled.has(accountId) || !status || running) return
    backfilled.add(accountId)
    void window.api.sync.details(accountId)
  }, [accountId, missing, status, running])

  if (missing === 0) return null
  return (
    <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span className="text-ink-2">
        {running ? (
          <>
            {status?.step ?? 'Downloading match details'}
            {status?.progress && (
              <span className="num text-muted">
                {' '}
                {status.progress.done + 1}/{status.progress.total}
              </span>
            )}
            …
          </>
        ) : (
          <>
            Habits and win conditions use games with full details: <span className="num text-ink">{analysis.analyzedGames}</span> of{' '}
            <span className="num">{analysis.totalGames}</span>. {status?.message ?? 'Trends use every game.'}
          </>
        )}
      </span>
      <button
        type="button"
        disabled={running}
        onClick={() => void window.api.sync.run({ accountId })}
        title="Downloads what the cloud and community cache don't have from Steam (limited requests)"
        className="ml-auto h-8 rounded-md border border-line px-3 text-xs text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
      >
        Sync (Steam for the rest)
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ summary

function TrendBadge({ habit }: { habit: Habit }) {
  if (!habit.trend || habit.trend === 'same') return habit.trend === 'same' ? <span className="text-[11px] text-muted">steady</span> : null
  const good = habit.trend === 'better'
  return (
    <span className={`text-[11px] ${good ? 'text-win' : 'text-loss'}`} title={`Newer games ${pct(habit.recentRate!)} vs older ${pct(habit.olderRate!)}`}>
      {good ? '▼ improving' : '▲ getting worse'}
    </span>
  )
}

function HabitRow({ habit, accountId }: { habit: Habit; accountId: number }) {
  const rate = habit.games / habit.of
  return (
    <li className="grid gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{habit.label}</span>
        <span className="num text-xs text-muted">
          {habit.games} of {habit.of} games
        </span>
        <span className="ml-auto">
          <TrendBadge habit={habit} />
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={habit.tone === 'bad' ? 'bg-loss' : 'bg-win'} style={{ width: `${rate * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="truncate">Latest: {habit.example}</span>
        <span className="flex gap-1">
          {habit.matchIds.slice(0, 4).map((id) => (
            <Link key={id} to="/matches/$matchId" params={{ matchId: id }} search={{ player: accountId }} className="num rounded bg-surface-2 px-1.5 py-0.5 hover:text-ink">
              #{String(id).slice(-4)}
            </Link>
          ))}
        </span>
      </div>
    </li>
  )
}

/** The big picture across heroes: patterns that show up on most of what you play. */
function CoachRead({ coaching, onOpenHeroes }: { coaching: HeroCoachingResult | null | 'loading'; onOpenHeroes: () => void }) {
  if (coaching === 'loading') return <div className="card p-4 text-sm text-muted">Comparing your heroes with top players…</div>
  if (!coaching) return null
  if (coaching.error) return <div className="card p-4 text-sm text-muted">Couldn't load hero benchmarks: {coaching.error}</div>
  const patterns = crossHeroPatterns(coaching).slice(0, 4)
  if (coaching.heroes.length === 0) return null
  return (
    <Card title="Coach's read" right={<button type="button" onClick={onOpenHeroes} className="text-xs text-muted hover:text-ink">By hero →</button>}>
      {patterns.length === 0 ? (
        <p className="p-4 text-sm text-ink-2">On your main heroes you're close to top players' level. Keep it up.</p>
      ) : (
        <ul className="divide-y divide-line">
          {patterns.map((p) => (
            <li key={p.title} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <span className="text-sm font-medium">{p.title}</span>
              <span className="num text-xs text-muted">
                on {p.heroes.length} of {coaching.heroes.length} heroes
              </span>
              <span className="ml-auto flex -space-x-1">
                {p.heroes.map((id) => (
                  <HeroIcon key={id} hero={coaching.heroInfo[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }} size={22} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">{benchmarkText(coaching)}</p>
    </Card>
  )
}

function Summary({ analysis, accountId }: { analysis: OverallAnalysis; accountId: number }) {
  const { habits, strengths } = analysis
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card title="Fix these first">
        {habits.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            {analysis.analyzedGames < 4 ? 'Not enough detailed games yet to spot habits.' : 'No problem shows up in more than a fifth of your games. Nice.'}
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {habits.slice(0, 6).map((h) => (
              <HabitRow key={h.key} habit={h} accountId={accountId} />
            ))}
          </ol>
        )}
      </Card>
      <Card title="Keep doing">
        {strengths.length === 0 ? (
          <p className="p-4 text-sm text-muted">{analysis.analyzedGames < 4 ? 'Not enough detailed games yet.' : 'No standout strength yet.'}</p>
        ) : (
          <ol className="divide-y divide-line">
            {strengths.slice(0, 5).map((h) => (
              <HabitRow key={h.key} habit={h} accountId={accountId} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ win conditions

function ConditionRow({ c }: { c: WinCondition }) {
  const withRate = c.withWins / c.withGames
  const withoutRate = c.withoutWins / c.withoutGames
  const strong = Math.abs(c.delta) >= 0.2
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_16rem] md:items-center">
      <div>
        <div className="text-sm">{c.label}</div>
        <div className="num text-xs text-muted">
          {c.delta >= 0 ? '+' : '−'}
          {Math.round(Math.abs(c.delta) * 100)} points of win rate{strong ? '' : ' (small difference)'}
        </div>
      </div>
      <div className="grid gap-1 text-xs">
        {[
          { label: 'when it happened', rate: withRate, w: c.withWins, n: c.withGames },
          { label: "when it didn't", rate: withoutRate, w: c.withoutWins, n: c.withoutGames },
        ].map((r) => (
          <div key={r.label} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2" title={`${r.w} wins in ${r.n} games`}>
            <span className="text-muted">{r.label}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={r.rate >= 0.5 ? 'h-full bg-win' : 'h-full bg-loss'} style={{ width: `${r.rate * 100}%` }} />
            </div>
            <span className="num text-right text-ink-2">
              {pct(r.rate)} <span className="text-muted">({r.n})</span>
            </span>
          </div>
        ))}
      </div>
    </li>
  )
}

function Conditions({ analysis }: { analysis: OverallAnalysis }) {
  const { winConditions } = analysis
  return (
    <Card title="What decides your games">
      {winConditions.length === 0 ? (
        <p className="p-4 text-sm text-muted">Needs at least 3 detailed games on each side of a condition. Get details for more games to fill this in.</p>
      ) : (
        <ol className="divide-y divide-line">
          {winConditions.map((c) => (
            <ConditionRow key={c.key} c={c} />
          ))}
        </ol>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Your win rate in games where each thing happened vs where it didn't, from {analysis.analyzedGames} detailed games. Biggest difference first.
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------ trends

const H = 150
const PAD = { top: 12, right: 12, bottom: 20, left: 40 }

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/**
 * One metric over games: a dot per game (green win / red loss) and a
 * rolling average line. Hover snaps to the nearest game.
 */
function GameChart({
  points,
  value,
  format,
  rolling = 10,
  domain,
  guide,
  label,
}: {
  points: TrendPoint[]
  value: (p: TrendPoint) => number | null
  format: (v: number) => string
  rolling?: number
  domain?: [number, number]
  guide?: number
  label: string
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const vals = points.map(value)
  const known = vals.filter((v): v is number => v != null)
  if (known.length < 3) return <p className="px-4 py-6 text-sm text-muted">Not enough games for this chart yet.</p>
  const lo = domain?.[0] ?? Math.min(...known) * 0.9
  const hi = domain?.[1] ?? Math.max(...known) * 1.05
  const innerW = Math.max(10, width - PAD.left - PAD.right)
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  // Rolling average over the last `rolling` known values.
  const avg = vals.map((_, i) => {
    const window = vals.slice(Math.max(0, i - rolling + 1), i + 1).filter((v): v is number => v != null)
    return window.length >= Math.min(3, rolling) ? window.reduce((a, b) => a + b, 0) / window.length : null
  })
  const path = avg
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .reduce<string[]>((acc, p, i, arr) => {
      if (p) acc.push(`${i > 0 && arr[i - 1] ? 'L' : 'M'}${p}`)
      return acc
    }, [])
    .join(' ')
  const ticks = [lo, (lo + hi) / 2, hi]
  const hp = hover != null ? points[hover] : undefined
  const hv = hover != null ? vals[hover] : null
  const ha = hover != null ? avg[hover] : null

  return (
    <div ref={ref} className="relative px-2 pb-2">
      <svg width={width} height={H} role="img" aria-label={label} className="block max-w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="2 4" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="num fill-muted text-[10px]">
              {format(t)}
            </text>
          </g>
        ))}
        {guide != null && <line x1={PAD.left} x2={width - PAD.right} y1={y(guide)} y2={y(guide)} stroke="var(--color-line-strong)" />}
        {points.map((p, i) => {
          const v = vals[i]
          return v == null ? null : <circle key={p.matchId} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={p.won ? 'var(--color-win)' : 'var(--color-loss)'} fillOpacity={0.55} />
        })}
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-line-strong)" />}
        <rect
          x={PAD.left}
          y={0}
          width={innerW}
          height={H}
          fill="transparent"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))))
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, x(hover!) - 70), width - 160) }}
        >
          <div className="text-muted">
            {new Date(hp.startTime * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })} · <span className={hp.won ? 'text-win' : 'text-loss'}>{hp.won ? 'Win' : 'Loss'}</span>
          </div>
          <div className="num text-ink">{hv != null ? format(hv) : '—'} this game</div>
          {ha != null && <div className="num text-ink-2">{format(ha)} avg of last {rolling}</div>}
        </div>
      )}
    </div>
  )
}

function CompareTiles({ stats, window }: { stats: PeriodStat[]; window: number }) {
  if (stats.length === 0) return null
  const fmt = (s: PeriodStat, v: number) => (s.format === 'pct' ? pct(v) : s.format === 'int' ? String(Math.round(v)) : v.toFixed(1))
  return (
    <Card title={`Last ${window} games vs the ${window * 2} before`}>
      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-5">
        {stats.map((s) => {
          const diff = s.recent - s.previous
          const rel = Math.abs(diff) / Math.max(Math.abs(s.previous), 1e-6)
          const flat = rel < 0.05
          const good = s.better === 'higher' ? diff > 0 : diff < 0
          return (
            <div key={s.label} className="bg-surface px-4 py-3">
              <div className="text-xs text-muted">{s.label}</div>
              <div className="num text-lg font-semibold">{fmt(s, s.recent)}</div>
              <div className={`num text-xs ${flat ? 'text-muted' : good ? 'text-win' : 'text-loss'}`}>
                {flat ? 'about the same' : `${diff > 0 ? '▲' : '▼'} from ${fmt(s, s.previous)}`}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Sessions({ analysis }: { analysis: OverallAnalysis }) {
  const rows = analysis.sessions.filter((s) => s.games > 0)
  if (rows.length < 2) return null
  const first = rows[0]!
  const later = rows.slice(1)
  const laterRate = later.reduce((a, s) => a + s.wins, 0) / Math.max(1, later.reduce((a, s) => a + s.games, 0))
  const firstRate = first.wins / first.games
  return (
    <Card title="Win rate by game in a session">
      <div className="grid gap-2 p-4">
        {rows.map((s) => {
          const rate = s.wins / s.games
          return (
            <div key={s.label} className="grid grid-cols-[8.5rem_1fr_6rem] items-center gap-3 text-sm" title={`${s.wins} wins in ${s.games} games`}>
              <span className="text-ink-2">{s.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className={rate >= 0.5 ? 'h-full bg-win' : 'h-full bg-loss'} style={{ width: `${rate * 100}%` }} />
              </div>
              <span className="num text-right text-xs text-ink-2">
                {pct(rate)} <span className="text-muted">({s.games})</span>
              </span>
            </div>
          )
        })}
        {firstRate - laterRate >= 0.12 && first.games >= 5 && (
          <p className="pt-1 text-xs text-ink-2">
            You win {pct(firstRate)} of your first game but {pct(laterRate)} after that. Consider stopping after a loss, or taking a break between games.
          </p>
        )}
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">A new session starts after 45 minutes without a game.</p>
    </Card>
  )
}

function Trends({ analysis }: { analysis: OverallAnalysis }) {
  const { trend } = analysis
  return (
    <div className="grid gap-4">
      <CompareTiles stats={analysis.compare} window={analysis.recentWindow} />
      <Card title={`Win rate · rolling ${10} games`}>
        <GameChart points={trend} value={(p) => (p.won ? 1 : 0)} format={pct} domain={[0, 1]} guide={0.5} label="Rolling win rate over your recent games" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Souls per minute">
          <GameChart points={trend} value={(p) => p.soulsPerMin} format={(v) => String(Math.round(v))} label="Souls per minute per game" />
        </Card>
        <Card title="Impact score (detailed games)">
          <GameChart points={trend} value={(p) => p.impact} format={(v) => String(Math.round(v))} domain={[0, 100]} guide={50} rolling={5} label="Impact score per detailed game" />
        </Card>
      </div>
      <Sessions analysis={analysis} />
      <p className="text-xs text-muted">Dots are games (green win, red loss); the line is the rolling average. Oldest on the left, last {trend.length} games.</p>
    </div>
  )
}

// ------------------------------------------------------------------ page

export function PlayerAnalysis({ analysis, accountId }: { analysis: PlayerAnalysisResult; accountId: number }) {
  const [section, setSection] = useState<Section>('summary')
  // Hero benchmarks come from the community API: load once per player, in the background.
  // Keyed by account so switching players shows "loading" instead of the previous player's result.
  const [loaded, setLoaded] = useState<{ accountId: number; result: HeroCoachingResult | null } | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.players
      .heroCoaching(accountId)
      .then((result) => alive && setLoaded({ accountId, result }))
      .catch(() => alive && setLoaded({ accountId, result: null }))
    return () => {
      alive = false
    }
  }, [accountId])
  const coaching: HeroCoachingResult | null | 'loading' = loaded?.accountId === accountId ? loaded.result : 'loading'
  if (analysis.totalGames === 0) return <p className="text-sm text-muted">No matches yet. Sync to load this player's history.</p>
  return (
    <div className="grid gap-4">
      <Coverage analysis={analysis} accountId={accountId} />
      <Segmented<Section>
        value={section}
        onChange={setSection}
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'heroes', label: 'Heroes' },
          { value: 'deaths', label: 'Deaths & fights' },
          { value: 'conditions', label: 'Win conditions' },
          { value: 'trends', label: 'Trends' },
        ]}
      />
      {section === 'summary' && (
        <div className="grid gap-4">
          <CoachRead coaching={coaching} onOpenHeroes={() => setSection('heroes')} />
          <Summary analysis={analysis} accountId={accountId} />
        </div>
      )}
      {section === 'heroes' && <HeroesSection analysis={analysis} coaching={coaching} />}
      {section === 'deaths' && <DeathsSection analysis={analysis} />}
      {section === 'conditions' && <Conditions analysis={analysis} />}
      {section === 'trends' && <Trends analysis={analysis} />}
    </div>
  )
}
