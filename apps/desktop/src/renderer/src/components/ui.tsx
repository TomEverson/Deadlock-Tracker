import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { timeAgo } from '@deadlock/core/lib/format'
import type { HeroInfo, RankInfo } from '@deadlock/core/domain/assets/types'

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || right) && (
        <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2">
          {title && <h2 className="text-sm font-medium text-ink">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

/** Underlined tab bar. `tabs` render as buttons or links supplied by the caller. */
export function TabBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={`flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none] ${className}`}>
      {children}
    </div>
  )
}

export const tabClass = (active: boolean) =>
  `-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm transition-colors ${active ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink-2'}`

/** Small pill-group toggle. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex w-fit rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-0.5 text-xs transition-colors ${value === o.value ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-muted hover:text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Win/loss dot used in lists. */
export function ResultDot({ won, abandoned = false }: { won: boolean; abandoned?: boolean }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${abandoned ? 'bg-muted' : won ? 'bg-win' : 'bg-loss'}`} aria-hidden />
}

export function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  if (!src) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-full bg-surface-2 font-medium text-ink-2"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full bg-surface-2 object-cover" loading="lazy" />
}

export function HeroIcon({ hero, size = 32 }: { hero: HeroInfo; size?: number }) {
  if (!hero.icon) {
    return (
      <div className="grid shrink-0 place-items-center rounded-md bg-surface-2 text-[10px] text-muted" style={{ width: size, height: size }} title={hero.name}>
        ?
      </div>
    )
  }
  return <img src={hero.icon} alt={hero.name} title={hero.name} width={size} height={size} className="shrink-0 rounded-md bg-surface-2 object-cover" loading="lazy" />
}

export function RankBadge({ rank, size = 28 }: { rank: RankInfo | null; size?: number }) {
  if (!rank) return <span className="text-sm text-muted">Unranked</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {rank.icon && <img src={rank.icon} alt="" width={size} height={size} />}
      <span className="text-sm text-ink-2">
        {rank.name} {rank.subrank}
      </span>
    </span>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="num mt-0.5 text-lg font-medium text-ink">{value}</div>
      {sub && <div className="num text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function WinLossPill({ won, abandoned = false }: { won: boolean; abandoned?: boolean }) {
  const [text, cls] = abandoned ? ['Left', 'text-muted'] : won ? ['Win', 'text-win'] : ['Loss', 'text-loss']
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${cls}`}>
      <ResultDot won={won} abandoned={abandoned} />
      {text}
    </span>
  )
}

/** Re-renders every 30s so "5m ago" labels stay honest on an open tab. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function TimeAgo({ at, className }: { at: string | number | null; className?: string }) {
  const now = useNow()
  if (at == null) return <span className={className}>never</span>
  const date = typeof at === 'number' ? new Date(at) : new Date(at)
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className} suppressHydrationWarning>
      {timeAgo(date, now)}
    </time>
  )
}

const subscribeNoop = () => () => {}

/** False on the server and during hydration, true after — for timezone-dependent rendering. */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}

/**
 * Absolute timestamp in the viewer's timezone. The server (UTC) can't know
 * it, so render a neutral placeholder on SSR and fill in after mount.
 */
export function LocalDateTime({ at, className }: { at: number; className?: string }) {
  const isClient = useIsClient()
  const text = isClient ? new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null
  return (
    <time dateTime={new Date(at).toISOString()} className={className}>
      {text ?? ' '.repeat(12)}
    </time>
  )
}
