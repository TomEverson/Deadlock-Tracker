import { useState } from 'react'
import { Card, HeroIcon, Segmented } from '~/components/ui'
import type { HeroInfo } from '@deadlock/core/domain/assets/types'
import type { PlayerAnalysisResult } from '@deadlock/core/domain/players/services/overall-analysis'
import type { DeathArea, DeathPoint, DeathsSummary, Phase } from '@deadlock/core/domain/players/services/player-deaths'

// Deaths & fights: where you die across all your detailed games (a heatmap
// on one schematic map, your base at the bottom and York on the left), when
// you die compared with your lobbies, who kills you, and how you show up to team fights.

const pct = (x: number) => `${Math.round(x * 100)}%`
const heroOf = (info: Record<number, HeroInfo>, id: number): HeroInfo => info[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }

type Filter = 'all' | Phase | 'alone'
const COLS = 9
const ROWS = 12
/** Lane centers on the normalized map (lanes evenly spaced, York left). */
const LANES = [
  { u: 1 / 6, name: 'York' },
  { u: 1 / 2, name: 'Broadway' },
  { u: 5 / 6, name: 'Greenwich' },
]

function Heatmap({ points, total }: { points: DeathPoint[]; total: number }) {
  const W = 340
  const H = 440
  const pad = 18
  const cw = (W - pad * 2) / COLS
  const ch = (H - pad * 2) / ROWS
  const grid = Array.from({ length: COLS * ROWS }, () => 0)
  for (const p of points) {
    const c = Math.min(COLS - 1, Math.floor(p.u * COLS))
    const r = Math.min(ROWS - 1, Math.floor(p.v * ROWS))
    grid[r * COLS + c]!++
  }
  const max = Math.max(1, ...grid)
  const sx = (u: number) => pad + u * (W - pad * 2)
  const sy = (v: number) => H - pad - v * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[340px]" role="img" aria-label={`Heatmap of ${points.length} deaths, your base at the bottom`}>
      <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx={8} fill="var(--color-surface-2)" />
      {LANES.map((l) => (
        <line key={l.name} x1={sx(l.u)} x2={sx(l.u)} y1={pad + 6} y2={H - pad - 6} stroke="var(--color-line-strong)" strokeWidth={8} strokeLinecap="round" opacity={0.6} />
      ))}
      <line x1={pad} x2={W - pad} y1={sy(0.5)} y2={sy(0.5)} stroke="var(--color-line-strong)" strokeDasharray="3 4" />
      {grid.map((n, i) => {
        if (n === 0) return null
        const c = i % COLS
        const r = Math.floor(i / COLS)
        return (
          <rect
            key={i}
            x={pad + c * cw + 1}
            y={H - pad - (r + 1) * ch + 1}
            width={cw - 2}
            height={ch - 2}
            rx={4}
            fill="var(--color-loss)"
            fillOpacity={0.15 + 0.8 * (n / max)}
          >
            <title>{`${n} death${n === 1 ? '' : 's'} (${pct(n / Math.max(1, total))} of these)`}</title>
          </rect>
        )
      })}
      {LANES.map((l) => (
        <text key={l.name} x={sx(l.u)} y={H - 5} textAnchor="middle" className="fill-muted text-[10px]">
          {l.name}
        </text>
      ))}
      <text x={W / 2} y={12} textAnchor="middle" className="fill-muted text-[10px]">
        enemy base
      </text>
      <text x={W - pad - 4} y={sy(0.5) - 4} textAnchor="end" className="fill-muted text-[9px]">
        middle of the map
      </text>
    </svg>
  )
}

const AREA_ROWS: { area: DeathArea; label: string }[] = [
  { area: 'enemy-base', label: 'Enemy base' },
  { area: 'enemy-jungle', label: 'Enemy jungle' },
  { area: 'lane-enemy', label: 'Lanes, past the middle' },
  { area: 'lane-own', label: 'Lanes, your side' },
  { area: 'own-jungle', label: 'Your jungle' },
  { area: 'own-base', label: 'Your base' },
]

function Bar({ share, tone = 'bg-loss' }: { share: number; tone?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(1, share) * 100}%` }} />
    </div>
  )
}

function WhereList({ deaths }: { deaths: DeathsSummary }) {
  const n = deaths.points.length
  return (
    <div className="grid content-start gap-5">
      <div>
        <div className="mb-2 text-xs font-medium text-muted">Where you die</div>
        <ul className="grid gap-2">
          {AREA_ROWS.map((r) => (
            <li key={r.area} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3 text-sm">
              <span className="text-ink-2">{r.label}</span>
              <Bar share={n ? deaths.areas[r.area] / n : 0} />
              <span className="num text-right text-xs text-ink-2">
                {pct(n ? deaths.areas[r.area] / n : 0)} <span className="text-muted">({deaths.areas[r.area]})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-muted">Most deaths at</div>
        <ul className="grid gap-1 text-sm">
          {deaths.places.slice(0, 6).map((p) => (
            <li key={p.place} className="flex justify-between gap-3">
              <span className="text-ink-2">{p.place}</span>
              <span className="num text-xs text-ink-2">
                {pct(p.deaths / Math.max(1, n))} <span className="text-muted">({p.deaths})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        Died alone (no living teammate nearby): <span className="num text-ink-2">{pct(n ? deaths.alone / n : 0)}</span>
        {deaths.lobbyAlone != null && <> vs {pct(deaths.lobbyAlone)} for players in your lobbies</>}.
      </p>
    </div>
  )
}

const PHASE_LABEL: Record<Phase, string> = { laning: 'Laning (0–9 min)', mid: 'Mid game (9–20 min)', late: 'Late game (20+ min)' }

function WhenCard({ deaths }: { deaths: DeathsSummary }) {
  const max = Math.max(0.1, ...deaths.phaseRates.flatMap((r) => [r.you, r.lobby]))
  return (
    <Card title="When you die">
      <div className="grid gap-3 p-4">
        {deaths.phaseRates.map((r) => {
          const high = r.you >= r.lobby * 1.25
          return (
            <div key={r.phase} className="grid gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-ink-2">{PHASE_LABEL[r.phase]}</span>
                <span className="num text-xs text-muted">{r.deaths} deaths</span>
              </div>
              <div className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-2 text-xs">
                <span className="text-ink-2">You</span>
                <Bar share={r.you / max} tone={high ? 'bg-loss' : 'bg-ink-2'} />
                <span className={`num text-right ${high ? 'text-loss' : 'text-ink-2'}`}>{r.you.toFixed(1)}</span>
                <span className="text-muted">Lobby avg</span>
                <Bar share={r.lobby / max} tone="bg-muted" />
                <span className="num text-right text-muted">{r.lobby.toFixed(1)}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Deaths per 10 minutes of each phase: yours vs the average player in the same games.</p>
    </Card>
  )
}

function KillersCard({ deaths, info }: { deaths: DeathsSummary; info: Record<number, HeroInfo> }) {
  const top = deaths.killers.slice(0, 6)
  const n = deaths.points.length
  return (
    <Card title="Who kills you">
      {top.length === 0 ? (
        <p className="p-4 text-sm text-muted">No hero kills recorded.</p>
      ) : (
        <ul className="grid gap-2 p-4">
          {top.map((k) => (
            <li key={k.heroId} className="flex items-center gap-2 text-sm">
              <HeroIcon hero={heroOf(info, k.heroId)} size={22} />
              <span className="min-w-0 flex-1 truncate">{heroOf(info, k.heroId).name}</span>
              <span className="num text-xs text-ink-2">
                {k.kills} kills <span className="text-muted">in {k.games} games · {pct(k.kills / Math.max(1, n))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Enemy heroes who got the kill when you died. Their pick rate matters: a hero you face often will be high on this list.</p>
    </Card>
  )
}

function FightsCard({ deaths }: { deaths: DeathsSummary }) {
  const f = deaths.fights
  if (f.possible === 0)
    return (
      <Card title="Team fights">
        <p className="p-4 text-sm text-muted">No team fights in games with positions yet.</p>
      </Card>
    )
  const thereDecided = f.thereWon + f.thereLost
  const awayDecided = f.awayWon + f.awayLost
  const segs = [
    { label: 'There at the start', n: f.there, cls: 'bg-win' },
    { label: 'Arrived late', n: f.late, cls: 'bg-ink-2' },
    { label: 'Missed it', n: f.missing, cls: 'bg-loss' },
  ]
  return (
    <Card title="Team fights">
      <div className="grid gap-4 p-4">
        <div>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {segs.map((s) => (s.n ? <div key={s.label} className={s.cls} style={{ width: `${(s.n / f.possible) * 100}%` }} title={`${s.label}: ${s.n}`} /> : null))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {segs.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${s.cls}`} />
                {s.label} <span className="num text-muted">{pct(s.n / f.possible)}</span>
              </span>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Team won, with you there</dt>
            <dd className="num">{thereDecided ? `${pct(f.thereWon / thereDecided)} of ${thereDecided}` : '–'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Team won, without you</dt>
            <dd className="num">{awayDecided ? `${pct(f.awayWon / awayDecided)} of ${awayDecided}` : '–'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">You died first</dt>
            <dd className="num">
              {f.diedFirst} <span className="text-xs text-muted">({f.diedFirstLost} of them lost)</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Team fights you could join</dt>
            <dd className="num">
              {f.possible} <span className="text-xs text-muted">in {f.games} games</span>
            </dd>
          </div>
        </dl>
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Team fight = 4+ deaths within 15s of each other, counted when you were alive at the start. Won/lost = one side lost 2+ more heroes; even fights aren't counted.
      </p>
    </Card>
  )
}

export function DeathsSection({ analysis }: { analysis: PlayerAnalysisResult }) {
  const [filter, setFilter] = useState<Filter>('all')
  const d = analysis.deaths
  if (d.points.length === 0)
    return <p className="text-sm text-muted">No deaths with positions yet. Positions come with full match details ({analysis.analyzedGames} of your games have them).</p>
  const shown = d.points.filter((p) => filter === 'all' || (filter === 'alone' ? p.alone : p.phase === filter))
  return (
    <div className="grid gap-4">
      {d.insights.length > 0 && (
        <Card title="Coach's read">
          <ul className="grid gap-2.5 p-4">
            {d.insights.map((i) => (
              <li key={i.text} className="flex gap-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.tone === 'bad' ? 'bg-loss' : i.tone === 'good' ? 'bg-win' : 'bg-ink-2'}`} aria-hidden />
                {i.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Death heatmap"
        right={
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All (${d.points.length})` },
              { value: 'laning', label: 'Laning' },
              { value: 'mid', label: 'Mid' },
              { value: 'late', label: 'Late' },
              { value: 'alone', label: 'Alone' },
            ]}
          />
        }
      >
        <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,340px)_1fr]">
          <div>
            <Heatmap points={shown} total={shown.length} />
            <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted">
              fewer
              <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--color-loss) 15%, transparent), var(--color-loss))' }} />
              more deaths
            </div>
          </div>
          <WhereList deaths={d} />
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          {shown.length} deaths from {d.games} games, stacked on one map: your base at the bottom and York on the left, whichever team you were on. Hover a square for the count. The
          map is drawn from where players stood, so it's a schematic, not the in-game minimap.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <WhenCard deaths={d} />
        <FightsCard deaths={d} />
        <KillersCard deaths={d} info={analysis.heroInfo} />
      </div>
    </div>
  )
}
