import { useState } from 'react'
import { Card, HeroIcon } from '~/components/ui'
import { formatDuration } from '@deadlock/core/lib/format'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import type { BuildNote, HeroCoaching, HeroCoachingResult, StatRow } from '@deadlock/core/domain/players/services/hero-coaching'
import { ItemHover, SLOT_COLOR } from '~/domain/matches/components/ItemHover'

const fmt = (v: number, f: StatRow['format']) => (f === 'pct' ? `${Math.round(v * 100)}%` : f === 'int' ? String(Math.round(v)) : v.toFixed(1))
const pct = (x: number) => `${Math.round(x * 100)}%`

function heroOf(info: Record<number, HeroInfo>, id: number): HeroInfo {
  return info[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }
}

export function benchmarkText(result: HeroCoachingResult): string {
  const rank = result.benchmark.rank?.name ?? 'Ascendant'
  return `Compared with top players of each hero: ranked matches at ${rank} and above (Phantom and above for heroes with few games there), last ${result.benchmark.windowDays} days. "Top level" = their median game.`
}

/** Patterns that repeat across heroes ("Playing too safe" on 3 of 3), strongest first. */
export function crossHeroPatterns(result: HeroCoachingResult) {
  const byPattern = new Map<string, { title: string; heroes: number[]; weight: number }>()
  for (const h of result.heroes) {
    for (const d of h.diagnosis) {
      if (d.tone !== 'bad') continue
      const title = d.title
        .replace(new RegExp(`\\b(on |like a |a )?${h.heroName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}('s)?\\b`, 'g'), '')
        .replace(/\s+/g, ' ')
        .replace(/ (should|enough)$/, '')
        .trim()
      const p = byPattern.get(title) ?? { title, heroes: [], weight: 0 }
      p.heroes.push(h.heroId)
      p.weight += d.weight
      byPattern.set(title, p)
    }
  }
  return [...byPattern.values()].sort((a, b) => b.heroes.length - a.heroes.length || b.weight - a.weight)
}

/** You as a share of top level: the bar fills to 100% at their median game. */
function LevelBar({ row }: { row: StatRow }) {
  const capped = Math.min(row.level, 1.5)
  const tone = row.level < 0.6 ? 'bg-loss' : row.level >= 0.95 ? 'bg-win' : 'bg-ink-2'
  return (
    <div className="flex items-center gap-2" title={`${Math.round(row.level * 100)}% of top level`}>
      <div className="relative h-1.5 flex-1 rounded-full bg-surface-2">
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${(capped / 1.5) * 100}%` }} />
        {/* top players' median */}
        <div className="absolute -top-1 h-3.5 w-px bg-muted" style={{ left: `${(1 / 1.5) * 100}%` }} />
      </div>
      <span className={`num w-10 text-right text-xs ${row.level < 0.6 ? 'text-loss' : row.level >= 0.95 ? 'text-win' : 'text-ink-2'}`}>{Math.round(row.level * 100)}%</span>
    </div>
  )
}

function StatsTable({ hero }: { hero: HeroCoaching }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-4 py-2 font-normal">Stat</th>
            <th className="px-2 py-2 text-right font-normal">You</th>
            <th className="px-2 py-2 text-right font-normal">Top players</th>
            <th className="w-[36%] px-4 py-2 font-normal" title="Your number as a share of top players' median; the tick is their level (100%)">
              % of top level
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {hero.stats.map((r) => (
            <tr key={r.key}>
              <td className="px-4 py-2">
                {r.label}
                {r.key_for_hero && (
                  <span className="ml-1.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent" title={`What ${hero.heroName} is played for`}>
                    key
                  </span>
                )}
              </td>
              <td className="num px-2 py-2 text-right">{fmt(r.you, r.format)}</td>
              <td className="num px-2 py-2 text-right text-muted" title={`Their good games (top quarter): ${fmt(r.topHigh, r.format)}`}>
                {fmt(r.top, r.format)}
              </td>
              <td className="px-4 py-2">
                <LevelBar row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const BUILD_GROUPS: { kind: BuildNote['kind']; title: string; hint: string }[] = [
  { kind: 'skipped-core', title: 'Core items you skip', hint: "Bought in 40%+ of top players' games on this hero; you bought it in 20% or fewer of yours" },
  { kind: 'late', title: 'Bought much later than top players', hint: "4+ minutes later than top players' typical buy time" },
  { kind: 'off-meta', title: 'Your picks top players skip', hint: 'In half or more of your games; under 8% of top players buy it on this hero' },
]

function ItemChip({ note, item, heroName }: { note: BuildNote; item: ItemInfo | undefined; heroName: string }) {
  const meta = (
    <>
      {pct(note.benchRate)} of top {heroName}s buy it{note.benchBuyTimeS != null ? `, around ${formatDuration(note.benchBuyTimeS)}` : ''}. You: {pct(note.yourRate)} of your games
      {note.yourBuyTimeS != null ? `, around ${formatDuration(note.yourBuyTimeS)}` : ''}.
    </>
  )
  const body = (
    <span className="flex items-center gap-2 rounded-md bg-surface-2 py-1 pl-1 pr-2.5">
      <span className="grid h-8 w-8 place-items-center rounded bg-surface" style={item ? { boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[item.slot]}` } : undefined}>
        {item?.icon ? <img src={item.icon} alt="" width={24} height={24} loading="lazy" /> : null}
      </span>
      <span className="grid text-xs leading-tight">
        <span className="text-ink">{item?.name ?? `Item ${note.itemId}`}</span>
        <span className="num text-muted">
          {note.kind === 'late' && note.yourBuyTimeS != null && note.benchBuyTimeS != null
            ? `you ${formatDuration(note.yourBuyTimeS)} · top ${formatDuration(note.benchBuyTimeS)}`
            : `top ${pct(note.benchRate)} · you ${pct(note.yourRate)}`}
        </span>
      </span>
    </span>
  )
  return item ? (
    <ItemHover item={item} meta={meta}>
      {body}
    </ItemHover>
  ) : (
    body
  )
}

function BuildNotes({ hero, items }: { hero: HeroCoaching; items: Record<number, ItemInfo> }) {
  if (hero.buildGames < 3)
    return <p className="p-4 text-sm text-muted">Needs at least 3 of your {hero.heroName} games with full details to compare builds ({hero.buildGames} so far).</p>
  if (hero.build.length === 0) return <p className="p-4 text-sm text-muted">Your {hero.heroName} build matches what top players buy.</p>
  return (
    <div className="grid gap-4 p-4">
      {BUILD_GROUPS.map((g) => {
        const notes = hero.build.filter((b) => b.kind === g.kind)
        if (notes.length === 0) return null
        return (
          <div key={g.kind} className="grid gap-2">
            <div className="text-xs text-muted" title={g.hint}>
              {g.title}
            </div>
            <div className="flex flex-wrap gap-2">
              {notes.slice(0, 8).map((n) => (
                <ItemChip key={n.itemId} note={n} item={items[n.itemId]} heroName={hero.heroName} />
              ))}
            </div>
          </div>
        )
      })}
      <p className="text-xs text-muted">
        Based on {hero.buildGames} of your {hero.heroName} games with full details, against top players' item choices and buy times (by how often they buy items, not win rate —
        late items always look like winners because only long games reach them).
      </p>
    </div>
  )
}

export function HeroCoachingView({ result }: { result: HeroCoachingResult }) {
  const [selected, setSelected] = useState<number | null>(result.heroes[0]?.heroId ?? null)
  const hero = result.heroes.find((h) => h.heroId === selected) ?? result.heroes[0]
  if (!hero) return <p className="text-sm text-muted">Play at least 3 games on a hero to get hero coaching.</p>
  const bad = hero.diagnosis.filter((d) => d.tone === 'bad')
  const good = hero.diagnosis.filter((d) => d.tone === 'good')
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Hero">
        {result.heroes.map((h) => (
          <button
            key={h.heroId}
            type="button"
            role="tab"
            aria-selected={h.heroId === hero.heroId}
            onClick={() => setSelected(h.heroId)}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${h.heroId === hero.heroId ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink-2 hover:border-line-strong'}`}
          >
            <HeroIcon hero={heroOf(result.heroInfo, h.heroId)} size={22} />
            {h.heroName}
            <span className="num text-xs text-muted">{h.games}</span>
          </button>
        ))}
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            <HeroIcon hero={heroOf(result.heroInfo, hero.heroId)} size={22} />
            {hero.heroName}
          </span>
        }
        right={
          <span className="num text-xs text-muted">
            you {hero.wins}–{hero.games - hero.wins} ({pct(hero.wins / hero.games)}){hero.topWinRate != null ? ` · top players win ${pct(hero.topWinRate)} (${hero.topGames.toLocaleString()} games)` : ''}
          </span>
        }
      >
        {hero.job && hero.job.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
            <span className="text-muted">How top players play it:</span>
            {hero.job.tags.map((t) => (
              <span key={t} className="rounded bg-surface-2 px-2 py-0.5 text-ink-2">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-6 p-4 md:grid-cols-2">
          <div>
            <div className="mb-3 text-xs font-medium text-loss">What to fix</div>
            {bad.length === 0 ? (
              <p className="text-sm text-muted">Nothing below par on this hero.</p>
            ) : (
              <ul className="grid gap-3">
                {bad.map((d) => (
                  <li key={d.title} className="flex gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-loss" aria-hidden />
                    <div>
                      <div className="text-sm">{d.title}</div>
                      <div className="text-xs text-muted">{d.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-3 text-xs font-medium text-win">What you do well</div>
            {good.length === 0 ? (
              <p className="text-sm text-muted">No stat in the top quarter yet.</p>
            ) : (
              <ul className="grid gap-3">
                {good.map((d) => (
                  <li key={d.title} className="flex gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-win" aria-hidden />
                    <div>
                      <div className="text-sm">{d.title}</div>
                      <div className="text-xs text-muted">{d.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card title={`Your ${hero.heroName} vs top ${hero.heroName} players`}>
        <StatsTable hero={hero} />
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Top players = their median game (hover for their good games). You = your average on {hero.heroName}. <span className="text-accent">key</span> = what this hero is played
          for, judged by what top players do on it.
        </p>
      </Card>

      <Card title="Build">
        <BuildNotes hero={hero} items={result.items} />
      </Card>

      <p className="text-xs text-muted">{benchmarkText(result)}</p>
    </div>
  )
}
