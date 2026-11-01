import { Link } from '@tanstack/react-router'
import { Avatar } from '~/components/ui'
import { pct } from '@deadlock/core/lib/format'
import type { Mate } from '@deadlock/core/domain/players/types'

export function MatesPanel({ mates, unavailable }: { mates: Mate[]; unavailable: boolean }) {
  if (unavailable) return <div className="card px-4 py-10 text-center text-sm text-muted">Teammate stats are unavailable right now.</div>
  if (mates.length === 0) return <div className="card px-4 py-10 text-center text-sm text-muted">No repeat teammates yet.</div>
  return (
    <div className="card">
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] gap-3 border-b border-line px-4 py-2 text-xs text-muted">
        <span>Played with</span>
        <span className="text-right">Games</span>
        <span className="text-right">Win rate</span>
      </div>
      <ul>
        {mates.map((m) => (
          <li key={m.accountId} className="border-b border-line last:border-b-0">
            <Link to="/players/$accountId" params={{ accountId: m.accountId }} className="grid h-11 grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-3 px-4 text-sm hover:bg-surface-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar src={m.avatar} name={m.name} size={22} />
                <span className="truncate font-medium">{m.name}</span>
              </span>
              <span className="num text-right text-ink-2">{m.games}</span>
              <span className={`num text-right ${m.wins / m.games >= 0.5 ? 'text-win' : 'text-loss'}`}>{pct(m.wins, m.games)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">From deadlock-api.com's match data, which may be incomplete.</p>
    </div>
  )
}
