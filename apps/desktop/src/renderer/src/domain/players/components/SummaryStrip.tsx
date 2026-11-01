import { Stat } from '~/components/ui'
import { formatDuration, formatSouls, kdaRatio, pct } from '@deadlock/core/lib/format'
import type { PlayerSummary } from '@deadlock/core/domain/players/types'

export function SummaryStrip({ summary }: { summary: PlayerSummary }) {
  const g = Math.max(1, summary.games)
  const avg = (n: number) => (n / g).toFixed(1)
  return (
    <div className="card grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x [&>*]:px-4 [&>*]:py-3">
      <Stat label="Win rate" value={pct(summary.wins, summary.games)} sub={`${summary.wins}W ${summary.games - summary.wins}L`} />
      <Stat label="KDA" value={kdaRatio(summary.kills, summary.deaths, summary.assists)} sub={`${avg(summary.kills)} / ${avg(summary.deaths)} / ${avg(summary.assists)}`} />
      <Stat label="Avg souls" value={formatSouls(summary.avgNetWorth)} sub="per game" />
      <Stat label="Avg length" value={formatDuration(summary.avgDurationS)} sub={`${summary.games} games`} />
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div className="label">Last {summary.recentForm.length}</div>
        <div className="mt-2 flex gap-1" aria-label={`Recent form: ${summary.recentForm.map((w) => (w ? 'W' : 'L')).join(' ')}`}>
          {summary.recentForm.map((won, i) => (
            <span key={i} className={`h-4 w-1.5 rounded-full ${won ? 'bg-win' : 'bg-loss'}`} title={won ? 'Win' : 'Loss'} />
          ))}
        </div>
      </div>
    </div>
  )
}
