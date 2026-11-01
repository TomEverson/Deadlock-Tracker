import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ItemInfo, ItemSection } from '@deadlock/core/domain/assets/types'
import { formatSouls } from '@deadlock/core/lib/format'

const CARD_W = 288
const OPEN_DELAY_MS = 120
const GAP = 8

export const SLOT_COLOR: Record<ItemInfo['slot'], string> = {
  weapon: 'var(--color-slot-weapon)',
  vitality: 'var(--color-slot-vitality)',
  spirit: 'var(--color-slot-spirit)',
  other: 'var(--color-muted)',
}
const SLOT_NAME: Record<ItemInfo['slot'], string> = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit', other: 'Item' }
const SECTION_NAME: Record<ItemSection['kind'], string> = { innate: 'Innate', passive: 'Passive', active: 'Active' }

function ItemCard({ item, meta, style }: { item: ItemInfo; meta?: ReactNode; style: CSSProperties }) {
  const sections = item.sections.filter((s) => s.text.length > 0 || s.stats.length > 0)
  return (
    <div role="tooltip" style={style} className="pointer-events-none fixed z-50 rounded-lg border border-line-strong bg-surface p-3 text-sm shadow-xl shadow-black/30">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2" style={{ boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[item.slot]}` }}>
          {item.icon && <img src={item.icon} alt="" width={26} height={26} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{item.name}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: SLOT_COLOR[item.slot] }} />
            <span>{SLOT_NAME[item.slot]}</span>
            {item.tier ? <span>· Tier {item.tier}</span> : null}
            {item.cost ? <span className="num">· {formatSouls(item.cost)} souls</span> : null}
          </div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${item.isActive ? 'bg-accent-bg text-accent' : 'bg-surface-2 text-muted'}`}>
          {item.isActive ? 'Active' : 'Passive'}
        </span>
      </div>

      {sections.map((s, i) => (
        <div key={i} className="mt-3 border-t border-line pt-2.5">
          {(sections.length > 1 || s.kind === 'active') && <div className="mb-1 text-[11px] font-medium text-muted">{SECTION_NAME[s.kind]}</div>}
          {s.text.length > 0 && (
            <p className="text-xs leading-relaxed text-ink-2">
              {s.text.map((r, j) => (
                <span key={j} className={r.hl ? 'font-medium text-ink' : undefined}>
                  {r.t}
                </span>
              ))}
            </p>
          )}
          {s.stats.length > 0 && (
            <dl className={`grid gap-y-0.5 text-xs ${s.text.length > 0 ? 'mt-2' : ''}`}>
              {s.stats.map((st) => (
                <div key={st.label} className="flex justify-between gap-3">
                  <dt className="text-muted">{st.label}</dt>
                  <dd className={`num ${st.important ? 'font-medium text-ink' : 'text-ink-2'}`}>{st.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}

      {meta && <div className="mt-3 border-t border-line pt-2 text-xs text-muted">{meta}</div>}
    </div>
  )
}

/**
 * Wraps an item icon; shows the item's details on hover or keyboard focus.
 * Rendered in a portal with fixed positioning so scroll containers (the
 * scoreboard table) can't clip it. Flips above the icon near the bottom edge.
 */
export function ItemHover({ item, meta, children }: { item: ItemInfo; meta?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const show = (delay: number) => {
    clear()
    timer.current = setTimeout(() => {
      if (ref.current) setRect(ref.current.getBoundingClientRect())
    }, delay)
  }
  const hide = () => {
    clear()
    setRect(null)
  }

  // Fixed position goes stale on scroll; just close.
  useEffect(() => {
    if (!rect) return
    const onScroll = () => setRect(null)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [rect])
  useEffect(() => clear, [])

  let style: CSSProperties = {}
  if (rect) {
    const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - GAP)
    const below = rect.bottom + GAP
    const roomBelow = window.innerHeight - below
    style = roomBelow >= 260 || roomBelow >= rect.top ? { left, top: below, width: CARD_W } : { left, bottom: window.innerHeight - rect.top + GAP, width: CARD_W }
  }

  return (
    <span
      ref={ref}
      className="inline-flex"
      tabIndex={0}
      aria-label={item.name}
      onMouseEnter={() => show(OPEN_DELAY_MS)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
    >
      {children}
      {rect && createPortal(<ItemCard item={item} meta={meta} style={style} />, document.body)}
    </span>
  )
}
