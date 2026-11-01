import { HeroIcon, TimeAgo } from '~/components/ui'
import { formatSouls, kdaRatio, pct } from '@deadlock/core/lib/format'
import type { HeroStatRow } from '@deadlock/core/domain/players/types'

const GRID = 'grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_6rem] items-center gap-3 sm:grid-cols-[1.75rem_minmax(0,1fr)_3rem_8rem_3.5rem_4rem_5rem]'

export function HeroTable({ heroes }: { heroes: HeroStatRow[] }) {
  if (heroes.length === 0) return <div className="card px-4 py-10 text-center text-sm text-muted">No matches yet.</div>
  const maxGames = Math.max(...heroes.map((h) => h.games))
  return (
    <div className="card">
      <div className={`${GRID} border-b border-line px-4 py-2 text-xs text-muted`}>
        <span />
        <span>Hero</span>
        <span className="text-right">Games</span>
        <span>Win rate</span>
        <span className="hidden text-right sm:block">KDA</span>
        <span className="hidden text-right sm:block">Souls</span>
        <span className="hidden text-right sm:block">Last played</span>
      </div>
      <ul>
        {heroes.map((h) => {
          const wr = h.wins / h.games
          return (
            <li key={h.hero.id} className={`${GRID} h-11 border-b border-line px-4 text-sm last:border-b-0`}>
              <HeroIcon hero={h.hero} size={28} />
              <span className="truncate font-medium">{h.hero.name}</span>
              <span className="num flex items-center justify-end gap-2 text-ink-2">
                {h.games}
              </span>
              <span className="flex items-center gap-2">
                <span className={`num w-9 ${wr >= 0.5 ? 'text-win' : 'text-loss'}`}>{pct(h.wins, h.games)}</span>
                <span className="hidden h-1 flex-1 overflow-hidden rounded-full bg-surface-2 sm:block" title={`${h.games} games`}>
                  <span className={`block h-full rounded-full ${wr >= 0.5 ? 'bg-win' : 'bg-loss'}`} style={{ width: `${(h.games / maxGames) * 100}%`, opacity: 0.35 + wr * 0.65 }} />
                </span>
              </span>
              <span className="num hidden text-right text-ink-2 sm:block">{kdaRatio(h.kills, h.deaths, h.assists)}</span>
              <span className="num hidden text-right text-ink-2 sm:block">{formatSouls(h.avgNetWorth)}</span>
              <TimeAgo at={h.lastPlayed * 1000} className="hidden text-right text-xs text-muted sm:block" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
