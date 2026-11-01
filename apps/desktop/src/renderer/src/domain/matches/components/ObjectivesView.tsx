import { useState } from 'react'
import { Card, HeroIcon, Segmented } from '~/components/ui'
import type { HeroInfo } from '@deadlock/core/domain/assets/types'
import { formatSouls, teamName } from '@deadlock/core/lib/format'
import type { ObjectivePlayer, ObjectivesReport, ObjectiveTotals } from '@deadlock/core/domain/matches/services/objectives'

function heroOf(heroes: Record<number, HeroInfo>, id: number): HeroInfo {
  return heroes[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }
}

interface Row {
  label: string
  hint?: string
  get: (t: ObjectiveTotals) => number
  souls?: boolean
  sub?: (t: ObjectiveTotals) => string
}

const ROWS: Row[] = [
  { label: 'Buildings destroyed', get: (t) => t.buildings },
  { label: 'Mid-Boss', get: (t) => t.midBoss },
  { label: 'Jungle camps', get: (t) => t.camps, sub: (t) => `${formatSouls(t.campSouls)} souls` },
  { label: 'Permanent buffs', hint: 'Soul Urn and Sinner\'s Sacrifice give 4 at once; Haunts and crates give the rest', get: (t) => t.permanentBuffs },
  { label: 'Temporary power-ups', get: (t) => t.tempBuffs },
  { label: 'Objective bounties', hint: 'Valve\'s "team bonus": payouts from buildings, the Unstable Rift and the Soul Urn, not split by source', get: (t) => t.bountySouls, souls: true },
  { label: 'Treasure souls', hint: 'Valve\'s "treasure" souls — likely includes Soul Urn and Sinner\'s Sacrifice payouts', get: (t) => t.treasureSouls, souls: true },
  { label: 'Breakables', hint: 'Crates and other breakables', get: (t) => t.breakableSouls, souls: true },
  { label: 'Boss souls', hint: 'Guardians, Walkers, Mid-Boss…', get: (t) => t.bossSouls, souls: true },
  { label: 'Comeback souls', hint: 'Extra souls the game gives the team that\'s behind', get: (t) => t.comebackSouls, souls: true },
]

function ComparisonRow({ row, ours, theirs }: { row: Row; ours: ObjectiveTotals; theirs: ObjectiveTotals }) {
  const a = row.get(ours)
  const b = row.get(theirs)
  const total = a + b
  const fmt = (n: number) => (row.souls ? formatSouls(n) : String(n))
  const tone = (mine: number, other: number) => (mine > other ? 'text-ink font-medium' : 'text-ink-2')
  return (
    <li className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3 px-4 py-2.5 md:grid-cols-[7rem_1fr_7rem]">
      <div className={`num text-right text-sm ${tone(a, b)}`}>
        {fmt(a)}
        {row.sub && <span className="block text-[11px] font-normal text-muted">{row.sub(ours)}</span>}
      </div>
      <div className="grid gap-1">
        <div className="text-center text-xs text-muted" title={row.hint}>
          {row.label}
          {row.hint && <span className="ml-1 cursor-help text-muted/70">ⓘ</span>}
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          {total > 0 && (
            <>
              <div className="bg-win" style={{ width: `${(a / total) * 100}%` }} />
              <div className="bg-loss" style={{ width: `${(b / total) * 100}%` }} />
            </>
          )}
        </div>
      </div>
      <div className={`num text-sm ${tone(b, a)}`}>
        {fmt(b)}
        {row.sub && <span className="block text-[11px] font-normal text-muted">{row.sub(theirs)}</span>}
      </div>
    </li>
  )
}

function BuffBreakdown({ totals, label }: { totals: ObjectiveTotals; label: string }) {
  const entries = Object.entries(totals.buffsByStat).sort((a, b) => b[1] - a[1])
  return (
    <div>
      <div className="mb-2 text-xs text-muted">{label}</div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted">None.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([stat, n]) => (
            <span key={stat} className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">
              {stat} <span className="num text-ink">×{n}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const PLAYER_COLS: { label: string; get: (p: ObjectivePlayer) => number | null; souls?: boolean; hint?: string }[] = [
  { label: 'Camps', get: (p) => p.camps },
  { label: 'Perm. buffs', get: (p) => p.permanentBuffs },
  { label: 'Temp.', get: (p) => p.tempBuffs },
  { label: 'Bounties', get: (p) => p.bountySouls, souls: true },
  { label: 'Treasure', get: (p) => p.treasureSouls, souls: true },
  { label: 'Breakables', get: (p) => p.breakableSouls, souls: true },
  { label: 'Avg unspent', get: (p) => p.avgUnspent, souls: true, hint: 'Souls sitting unspent, averaged over the game' },
]

export function ObjectivesView({ report, team, heroes, highlight }: { report: ObjectivesReport; team: number; heroes: Record<number, HeroInfo>; highlight: number | null }) {
  const [side, setSide] = useState<'ours' | 'theirs'>('ours')
  const shownTeam = side === 'ours' ? team : 1 - team
  const rows = report.players.filter((p) => p.team === shownTeam)
  const best = (get: (p: ObjectivePlayer) => number | null) => Math.max(...rows.map((p) => get(p) ?? 0))
  return (
    <div className="grid gap-4">
      <Card title="Objectives">
        <div className="grid grid-cols-[5rem_1fr_5rem] gap-3 border-b border-line px-4 py-2 text-xs md:grid-cols-[7rem_1fr_7rem]">
          <span className="text-right text-win">Your team · {teamName(team)}</span>
          <span />
          <span className="text-loss">{teamName(1 - team)}</span>
        </div>
        <ul className="divide-y divide-line">
          {ROWS.map((r) => (
            <ComparisonRow key={r.label} row={r} ours={report.ours} theirs={report.theirs} />
          ))}
        </ul>
      </Card>

      <Card title="Permanent buffs by stat">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <BuffBreakdown totals={report.ours} label={`Your team · ${report.ours.permanentBuffs}`} />
          <BuffBreakdown totals={report.theirs} label={`${teamName(1 - team)} · ${report.theirs.permanentBuffs}`} />
        </div>
      </Card>

      <Card
        title="By player"
        right={
          <Segmented<'ours' | 'theirs'>
            value={side}
            onChange={setSide}
            options={[
              { value: 'ours', label: 'Your team' },
              { value: 'theirs', label: 'Enemy' },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-normal">Player</th>
                {PLAYER_COLS.map((c) => (
                  <th key={c.label} className="px-2 py-2 text-right font-normal" title={c.hint}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.accountId} className={p.accountId === highlight ? 'bg-surface-2/50' : ''}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <HeroIcon hero={heroOf(heroes, p.heroId)} size={24} />
                      <span className="max-w-40 truncate">{p.name}</span>
                    </div>
                  </td>
                  {PLAYER_COLS.map((c) => {
                    const v = c.get(p)
                    const top = c.label !== 'Avg unspent' && v != null && v > 0 && v === best(c.get)
                    return (
                      <td key={c.label} className={`num px-2 py-2 text-right ${top ? 'font-medium text-ink' : 'text-ink-2'}`}>
                        {v == null ? '—' : c.souls ? formatSouls(v) : v}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted">
        Valve's match data doesn't name Soul Urn deliveries, Sinner's Sacrifice hits or Unstable Rift captures. Their rewards are counted where they land: buffs under
        permanent buffs, souls under objective bounties and treasure.
      </p>
    </div>
  )
}
