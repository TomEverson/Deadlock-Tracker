import { useEffect, useRef, useState } from 'react'
import { formatDuration, formatSouls, TEAM_NAMES } from '@deadlock/core/lib/format'
import type { MatchDetailData } from '@deadlock/core/domain/matches/validators/match-detail'

const HEIGHT = 180
const PAD = { top: 12, right: 12, bottom: 22, left: 44 }

/**
 * Diverging chart: team soul lead over time. Above the zero line = Hidden
 * King ahead (amber), below = Archmother ahead (sapphire). Hover snaps to
 * the nearest stats snapshot.
 */
export function NetWorthChart({ timeline }: { timeline: MatchDetailData['netWorthTimeline'] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const points = [{ t: 0, team0: 0, team1: 0 }, ...timeline]
  if (timeline.length < 2) return <p className="px-4 py-6 text-sm text-muted">Not enough data for a soul graph.</p>

  const leads = points.map((p) => p.team0 - p.team1)
  const maxAbs = Math.max(1000, ...leads.map(Math.abs))
  const maxT = points.at(-1)?.t ?? 1
  const innerW = Math.max(10, width - PAD.left - PAD.right)
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (t: number) => PAD.left + (t / maxT) * innerW
  const y = (v: number) => PAD.top + innerH / 2 - (v / maxAbs) * (innerH / 2)
  const zeroY = y(0)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(leads[i] ?? 0).toFixed(1)}`).join(' ')
  const area = `${line} L${x(maxT).toFixed(1)},${zeroY} L${x(0)},${zeroY} Z`
  const ticks = [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs]
  const timeTicks = Array.from({ length: Math.floor(maxT / 600) + 1 }, (_, i) => i * 600).filter((t) => t > 0 && t < maxT - 120)

  const hp = hover !== null ? points[hover] : undefined
  const hl = hover !== null ? (leads[hover] ?? 0) : 0

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * maxT
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs((points[best]?.t ?? 0) - t)) best = i
    })
    setHover(best)
  }

  return (
    <div ref={wrap} className="relative px-2 pb-2">
      <div className="pointer-events-none absolute left-14 top-3 flex items-center gap-1.5 text-xs text-ink-2">
        <span className="h-2 w-2 rounded-sm bg-team0" /> {TEAM_NAMES[0]} ahead
      </div>
      <div className="pointer-events-none absolute bottom-8 left-14 flex items-center gap-1.5 text-xs text-ink-2">
        <span className="h-2 w-2 rounded-sm bg-team1" /> {TEAM_NAMES[1]} ahead
      </div>
      <svg width={width} height={HEIGHT} role="img" aria-label="Team soul lead over time" className="block max-w-full">
        <defs>
          <clipPath id="nw-above">
            <rect x={0} y={0} width={width} height={zeroY} />
          </clipPath>
          <clipPath id="nw-below">
            <rect x={0} y={zeroY} width={width} height={HEIGHT - zeroY} />
          </clipPath>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeDasharray={v === 0 ? undefined : '2 4'} />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="num fill-muted text-[10px]">
              {v === 0 ? '0' : formatSouls(Math.abs(v))}
            </text>
          </g>
        ))}
        {timeTicks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle" className="num fill-muted text-[10px]">
            {Math.round(t / 60)}m
          </text>
        ))}
        <path d={area} fill="var(--color-team0)" fillOpacity={0.28} clipPath="url(#nw-above)" />
        <path d={area} fill="var(--color-team1)" fillOpacity={0.28} clipPath="url(#nw-below)" />
        <path d={line} fill="none" stroke="var(--color-ink-2)" strokeWidth={2} strokeLinejoin="round" />
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--color-ink-2)" strokeOpacity={0.5} />
            <circle cx={x(hp.t)} cy={y(hl)} r={4.5} fill={hl >= 0 ? 'var(--color-team0)' : 'var(--color-team1)'} stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={0}
          width={innerW}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-44 rounded-md border border-line bg-surface-2 p-2.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(8, x(hp.t) - 88), width - 184) }}
        >
          <div className="num mb-1 text-muted">{formatDuration(hp.t)}</div>
          <div className="flex justify-between">
            <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm bg-team0" />{TEAM_NAMES[0]}</span>
            <span className="num">{formatSouls(hp.team0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm bg-team1" />{TEAM_NAMES[1]}</span>
            <span className="num">{formatSouls(hp.team1)}</span>
          </div>
          <div className="mt-1 border-t border-line pt-1 text-ink">
            {hl === 0 ? 'Even' : `${TEAM_NAMES[hl > 0 ? 0 : 1]} +${formatSouls(Math.abs(hl))}`}
          </div>
        </div>
      )}
      <details className="px-2 text-xs text-muted">
        <summary className="cursor-pointer select-none py-1 hover:text-ink">Show as table</summary>
        <table className="num mt-1 w-full text-left">
          <thead>
            <tr><th className="py-1 font-normal">Time</th><th className="font-normal">{TEAM_NAMES[0]}</th><th className="font-normal">{TEAM_NAMES[1]}</th><th className="font-normal">Lead</th></tr>
          </thead>
          <tbody className="text-ink-2">
            {timeline.map((p) => (
              <tr key={p.t} className="border-t border-line">
                <td className="py-1">{formatDuration(p.t)}</td>
                <td>{formatSouls(p.team0)}</td>
                <td>{formatSouls(p.team1)}</td>
                <td>{p.team0 === p.team1 ? '—' : `${p.team0 > p.team1 ? 'HK' : 'AM'} +${formatSouls(Math.abs(p.team0 - p.team1))}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
