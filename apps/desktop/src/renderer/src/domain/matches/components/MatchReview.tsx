import { useState } from 'react'
import { Card, HeroIcon, Segmented } from '~/components/ui'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import { formatDuration, formatSouls } from '@deadlock/core/lib/format'
import type { Area, CounterItem, CounterReport, Finding, MatchAnalysis, Tone } from '@deadlock/core/domain/matches/services/analysis'
import type { CoachReview, DeathMap, FightReview } from '@deadlock/core/domain/matches/services/coach'
import type { CounterRole } from '@deadlock/core/domain/matches/data/hero-counters'
import type { Threat, ThreatCounter } from '@deadlock/core/domain/matches/services/match-facts'
import { ItemHover, SLOT_COLOR } from './ItemHover'

const TONE_TEXT: Record<Tone, string> = { good: 'text-win', bad: 'text-loss', info: 'text-ink-2' }
const TONE_DOT: Record<Tone, string> = { good: 'bg-win', bad: 'bg-loss', info: 'bg-muted' }
const AREA_LABEL: Record<Area, string> = {
  laning: 'Laning',
  farm: 'Farm',
  fighting: 'Fighting',
  deaths: 'Deaths',
  items: 'Items',
  macro: 'Macro',
  impact: 'Impact',
}
const AREA_ORDER: Area[] = ['laning', 'farm', 'fighting', 'deaths', 'items', 'macro', 'impact']
const ROLE_LABEL: Record<CounterRole, string> = { disable: 'Shut down', protect: 'Protect', save: 'Team save', antiHeal: 'Anti-heal', punish: 'Punish' }
const ROLE_HINT: Record<CounterRole, string> = {
  disable: 'Used on them — one teammate owning it covers the team',
  protect: 'Only protects the owner — whoever they keep killing needs it',
  save: 'Cast on an ally — one per team',
  antiHeal: 'Cuts their healing',
  punish: 'Extra damage against what they rely on',
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatSouls(Math.abs(n))}`

function heroOf(heroes: Record<number, HeroInfo>, id: number): HeroInfo {
  return heroes[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }
}

function AreaChip({ area }: { area: Area }) {
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{AREA_LABEL[area]}</span>
}

// ------------------------------------------------------------------ verdict

export function VerdictCard({ review, won }: { review: CoachReview; won: boolean }) {
  return (
    <Card title="How the game went">
      <div className="grid gap-4 p-4">
        <div>
          <div className={`text-lg font-semibold ${won ? 'text-win' : 'text-loss'}`}>{review.headline}</div>
          <p className="mt-1 text-sm text-ink-2">{review.story}</p>
        </div>
        <ol className={`grid gap-px overflow-hidden rounded-md border border-line bg-line ${review.phases.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {review.phases.map((p) => (
            <li key={p.key} className="bg-surface p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted">{p.label}</span>
                <span className={`num text-sm font-medium ${TONE_TEXT[p.tone]}`}>{signed(p.leadEnd - p.leadStart)}</span>
              </div>
              <div className="num mt-1 text-xs text-ink-2">
                lead {signed(p.leadStart)} → {signed(p.leadEnd)}
              </div>
              <p className="mt-1.5 text-xs text-muted">{p.summary.split(' · ').slice(1).join(' · ')}</p>
            </li>
          ))}
        </ol>
        {review.decisive && (
          <div className="flex gap-2.5 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[review.decisive.tone]}`} aria-hidden />
            <span>
              <span className="text-muted">Turning point · </span>
              {review.decisive.text}
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ focus

export function FocusCard({ review }: { review: CoachReview }) {
  return (
    <Card title={review.focusFor === 'you' ? 'Work on this next game' : `Work on this next game · ${review.focusFor}`}>
      {review.focus.length === 0 ? (
        <p className="p-4 text-sm text-muted">Nothing major to fix — clean game.</p>
      ) : (
        <ol className="grid gap-3 p-4">
          {review.focus.map((f, i) => (
            <li key={f.title} className="flex gap-3">
              <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {f.title} <AreaChip area={f.area} />
                </div>
                {f.detail && <p className="mt-0.5 text-xs text-muted">{f.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ threats

function CounterIcon({ counter, item, heroes }: { counter: ThreatCounter; item: ItemInfo | undefined; heroes: Record<number, HeroInfo> }) {
  const owned = counter.buyers.length > 0
  const meta = owned ? (
    <>
      Bought by{' '}
      {counter.buyers.map((b, i) => (
        <span key={b.accountId}>
          {i > 0 && ', '}
          <span className="text-ink-2">{heroOf(heroes, b.heroId).name}</span> <span className="num">{formatDuration(b.t)}</span>
        </span>
      ))}
    </>
  ) : (
    <>Nobody on your team bought it · {ROLE_HINT[counter.role]}</>
  )
  const tile = (
    <div className={`relative grid h-9 w-9 place-items-center rounded-md bg-surface-2 ${owned ? 'ring-1 ring-win/60' : 'opacity-60 grayscale'}`} style={item ? { boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[item.slot]}` } : undefined}>
      {item?.icon ? <img src={item.icon} alt={counter.name} width={26} height={26} loading="lazy" /> : <span className="px-0.5 text-center text-[8px] leading-tight text-ink-2">{counter.name}</span>}
      {owned && (
        <span className="absolute -bottom-1 -right-1">
          <HeroIcon hero={heroOf(heroes, counter.buyers[0]!.heroId)} size={16} />
        </span>
      )}
    </div>
  )
  return item ? (
    <ItemHover item={item} meta={meta}>
      {tile}
    </ItemHover>
  ) : (
    <span title={counter.name}>{tile}</span>
  )
}

function ThreatRow({ threat, heroes, items, major }: { threat: Threat; heroes: Record<number, HeroInfo>; items: Record<number, ItemInfo>; major: boolean }) {
  const hero = heroOf(heroes, threat.heroId)
  const roles = [...new Set(threat.counters.map((c) => c.role))]
  const disables = threat.counters.filter((c) => c.role === 'disable')
  const uncovered = major && disables.length > 0 && disables.every((c) => c.buyers.length === 0)
  return (
    <li className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,14rem)_1fr] md:items-center">
      <div className="flex items-center gap-3">
        <HeroIcon hero={hero} size={36} />
        <div className="min-w-0">
          <div className="truncate font-medium">{hero.name}</div>
          <div className="num text-xs text-muted">
            {threat.kills} kills · {Math.round(threat.damageShare * 100)}% of their damage
          </div>
          {threat.topVictim && (
            <div className="flex items-center gap-1 text-[11px] text-muted">
              killed <HeroIcon hero={heroOf(heroes, threat.topVictim.heroId)} size={14} /> {threat.topVictim.kills}×
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        {threat.counters.length === 0 ? (
          <span className="text-xs text-muted">No counter data for this hero.</span>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {roles.map((role) => (
              <div key={role} className="grid gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted" title={ROLE_HINT[role]}>
                  {ROLE_LABEL[role]}
                </span>
                <div className="flex gap-1.5">
                  {threat.counters
                    .filter((c) => c.role === role)
                    .map((c) => (
                      <CounterIcon key={c.name} counter={c} item={c.itemId != null ? items[c.itemId] : undefined} heroes={heroes} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {uncovered && <p className="text-xs text-loss">Nobody could shut {hero.name} down — one of the shut-down items on any teammate would have.</p>}
      </div>
    </li>
  )
}

function CoverageCell({ item, needed }: { item: CounterItem | null; needed: boolean }) {
  if (!item) return <span className={needed ? 'text-loss' : 'text-muted'}>{needed ? 'missing' : '—'}</span>
  return (
    <span title={`${item.name} at ${formatDuration(item.t)}`}>
      <span className="num">{formatDuration(item.t)}</span>
      <span className="block truncate text-[11px] text-muted">{item.name}</span>
    </span>
  )
}

const COVERAGE: { kind: 'antiHeal' | 'bulletResist' | 'spiritResist' | 'shred'; label: string }[] = [
  { kind: 'antiHeal', label: 'Anti-heal' },
  { kind: 'bulletResist', label: 'Bullet resist' },
  { kind: 'spiritResist', label: 'Spirit resist' },
  { kind: 'shred', label: 'Resist shred' },
]

/** Enemy heroes ranked by how much they hurt you, their counter items, and your team's itemization. */
export function ThreatsCard({
  counters,
  heroes,
  items,
  highlight,
  majorThreat,
}: {
  counters: CounterReport
  heroes: Record<number, HeroInfo>
  items: Record<number, ItemInfo>
  highlight: number | null
  majorThreat: number
}) {
  const [showAll, setShowAll] = useState(false)
  const { healers, enemyHealing, healShare, spiritShare, needs, rows, threats, tagsLoaded } = counters
  const shown = showAll ? threats : threats.slice(0, 3)
  const needed = (kind: (typeof COVERAGE)[number]['kind']) => tagsLoaded && kind !== 'shred' && needs[kind]
  return (
    <Card title="Enemy threats & counters">
      <ul className="divide-y divide-line">
        {shown.map((t) => (
          <ThreatRow key={t.accountId} threat={t} heroes={heroes} items={items} major={t.score >= majorThreat} />
        ))}
      </ul>
      {threats.length > 3 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-line px-4 py-2 text-left text-xs text-muted hover:text-ink">
          {showAll ? 'Show top 3' : `Show all ${threats.length} enemy heroes`}
        </button>
      )}

      <div className="grid gap-3 border-t border-line p-4 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted">Enemy healing</div>
          <div className="num">
            {formatSouls(enemyHealing)} <span className="text-xs text-muted">· {Math.round(healShare * 100)}% of your hero damage</span>
            {needs.antiHeal && <span className="ml-2 rounded bg-loss-bg px-1.5 py-0.5 text-[11px] text-loss">anti-heal needed</span>}
          </div>
          {healers.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {healers.map((h) => (
                <span key={h.accountId} className="flex items-center gap-1.5 text-xs text-ink-2">
                  <HeroIcon hero={heroOf(heroes, h.heroId)} size={20} />
                  <span className="num">{formatSouls(h.healing)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {spiritShare != null && (
          <div>
            <div className="text-xs text-muted">Enemy damage, estimated from their builds</div>
            <div className="num flex flex-wrap items-center gap-x-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: SLOT_COLOR.weapon }} />
                {Math.round((1 - spiritShare) * 100)}% weapon
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: SLOT_COLOR.spirit }} />
                {Math.round(spiritShare * 100)}% spirit
              </span>
            </div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div style={{ width: `${(1 - spiritShare) * 100}%`, background: SLOT_COLOR.weapon }} />
              <div style={{ width: `${spiritShare * 100}%`, background: SLOT_COLOR.spirit }} />
            </div>
          </div>
        )}
      </div>

      {tagsLoaded ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-normal">Your team</th>
                {COVERAGE.map((c) => (
                  <th key={c.kind} className={`px-2 py-2 font-normal ${needed(c.kind) ? 'text-ink-2' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.accountId} className={r.accountId === highlight ? 'bg-surface-2/50' : ''}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <HeroIcon hero={heroOf(heroes, r.heroId)} size={24} />
                      <span className="max-w-40 truncate">{r.name}</span>
                    </div>
                  </td>
                  {COVERAGE.map((c) => (
                    <td key={c.kind} className="max-w-32 px-2 py-2 align-top">
                      <CoverageCell item={r[c.kind]} needed={needed(c.kind)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t border-line p-4 text-xs text-muted">Item stats haven't loaded, so anti-heal and resist coverage can't be checked. Restart the app to load them.</p>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ fights

const RESULT_STYLE: Record<FightReview['result'], string> = { won: 'bg-win-bg text-win', lost: 'bg-loss-bg text-loss', even: 'bg-surface-2 text-ink-2' }

export function FightReviewCard({ fights, heroes, hasPositions }: { fights: FightReview[]; heroes: Record<number, HeroInfo>; hasPositions: boolean }) {
  const [filter, setFilter] = useState<'all' | 'teamfight'>('all')
  const shown = filter === 'all' ? fights : fights.filter((f) => f.kind === 'teamfight')
  const teamfights = fights.filter((f) => f.kind === 'teamfight').length
  return (
    <Card
      title={`Fight review · ${fights.length} fights`}
      right={
        <Segmented<'all' | 'teamfight'>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${fights.length})` },
            { value: 'teamfight', label: `Team fights (${teamfights})` },
          ]}
        />
      }
    >
      {shown.length === 0 ? (
        <p className="p-4 text-sm text-muted">No fights here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-normal">Time</th>
                <th className="px-2 py-2 font-normal">Result</th>
                <th className="px-2 py-2 font-normal" title="Estimated from kill bounties and souls dropped">
                  Souls
                </th>
                {hasPositions && <th className="px-2 py-2 font-normal">Where</th>}
                <th className="px-2 py-2 font-normal">Who died (in order)</th>
                <th className="px-2 py-2 font-normal" title="Your alive teammates who weren't at the fight when it started">
                  Your team missing
                </th>
                <th className="px-2 py-2 font-normal">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((f) => (
                <tr key={f.t}>
                  <td className="num px-4 py-2 text-ink-2">
                    {formatDuration(f.t)}
                    <span className="block text-[11px] text-muted">lead {signed(f.leadBefore)}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`num rounded px-1.5 py-0.5 text-xs ${RESULT_STYLE[f.result]}`}>
                      {f.result === 'won' ? 'Won' : f.result === 'lost' ? 'Lost' : 'Even'} {f.theirDeaths}–{f.ourDeaths}
                    </span>
                    <span className="block pt-1 text-[11px] text-muted">{f.kind === 'teamfight' ? 'team fight' : 'skirmish'}</span>
                  </td>
                  <td className="num px-2 py-2 text-xs">
                    {f.souls == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={f.souls > 0 ? 'text-win' : f.souls < 0 ? 'text-loss' : 'text-ink-2'}>≈ {signed(f.souls)}</span>
                    )}
                  </td>
                  {hasPositions && <td className="max-w-40 truncate px-2 py-2 text-xs text-ink-2">{f.where ?? '—'}</td>}
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap gap-1">
                      {f.deaths.map((d, i) => (
                        <span
                          key={`${d.accountId}-${d.t}`}
                          className={`rounded-md p-px ring-1 [&_img]:pointer-events-none [&_div]:pointer-events-none ${d.ours ? 'ring-loss' : 'ring-win'}`}
                          title={[
                            `${formatDuration(d.t)} · ${heroOf(heroes, d.heroId).name} (${d.name}) died${d.killerHeroId != null ? ` to ${heroOf(heroes, d.killerHeroId).name}` : ''}`,
                            i === 0 ? 'first death' : null,
                            d.value != null ? `≈ ${formatSouls(d.value)} souls to the ${d.ours ? 'enemy' : 'your team'}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <HeroIcon hero={heroOf(heroes, d.heroId)} size={20} />
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {f.kind === 'skirmish' ? (
                      <span className="text-xs text-muted">—</span>
                    ) : f.missing.length ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {f.missing.map((m) => (
                          <span
                            key={m.accountId}
                            className="flex items-center gap-1 text-[11px] text-muted [&_img]:pointer-events-none [&_div]:pointer-events-none"
                            title={`${heroOf(heroes, m.heroId).name} (${m.name}) ${m.late ? 'arrived after the fight started' : 'never came'}`}
                          >
                            <HeroIcon hero={heroOf(heroes, m.heroId)} size={20} />
                            {m.late ? 'late' : 'absent'}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">nobody — all there</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {f.taken.length > 0 && <span className="text-win">took {f.taken.join(', ')}</span>}
                    {f.taken.length > 0 && f.lost.length > 0 && <span className="text-muted"> · </span>}
                    {f.lost.length > 0 && <span className="text-loss">lost {f.lost.join(', ')}</span>}
                    {f.taken.length === 0 && f.lost.length === 0 && <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Every time two or more heroes died within 15s of each other. Team fight = 4+ deaths. Red ring = your team died, green = enemy died; hover for the killer. Souls are estimated: Valve only records soul totals every few minutes.{' '}
        {hasPositions
          ? '"Missing" = alive but not near the fight when it started: late = arrived during it, absent = never came.'
          : '"Missing" = alive with no kill or death in it (this match was saved without positions, so assists can\'t be seen).'}
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------ death map

/**
 * Every death on the map, your base at the bottom. Lanes and bases are
 * inferred from where players stood, so this is a schematic, not the
 * in-game minimap.
 */
export function DeathMapCard({ map, heroes, highlight }: { map: DeathMap; heroes: Record<number, HeroInfo>; highlight: number | null }) {
  const [show, setShow] = useState<'all' | 'yours' | 'theirs'>('all')
  const W = 360
  const H = 440
  const pad = 16
  const [x0, x1] = map.xRange
  const ySpan = map.enemyBaseY - map.ourBaseY
  // Map y → screen: our base at the bottom whichever team we are.
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (W - pad * 2) * (ySpan > 0 ? 1 : -1) + (ySpan > 0 ? 0 : W - pad * 2)
  const sy = (y: number) => H - pad - ((y - map.ourBaseY) / ySpan) * (H - pad * 2)
  const deaths = map.deaths.filter((d) => show === 'all' || (show === 'yours') === d.ours)
  const ours = map.deaths.filter((d) => d.ours).length
  return (
    <Card
      title="Death map"
      right={
        <Segmented<'all' | 'yours' | 'theirs'>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'yours', label: `Your deaths (${ours})` },
            { value: 'theirs', label: `Kills (${map.deaths.length - ours})` },
          ]}
        />
      }
    >
      <div className="grid gap-4 p-4 md:grid-cols-[auto_1fr]">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[360px]" role="img" aria-label="Deaths on the map, your base at the bottom">
          <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx={8} fill="var(--color-surface-2)" />
          <line x1={pad} x2={W - pad} y1={sy((map.ourBaseY + map.enemyBaseY) / 2)} y2={sy((map.ourBaseY + map.enemyBaseY) / 2)} stroke="var(--color-line-strong)" strokeDasharray="3 4" />
          {map.lanes.map((x) => (
            <line key={x} x1={sx(x)} x2={sx(x)} y1={pad + 8} y2={H - pad - 8} stroke="var(--color-line-strong)" strokeWidth={10} strokeLinecap="round" opacity={0.5} />
          ))}
          <text x={W / 2} y={H - 4} textAnchor="middle" className="fill-muted text-[10px]">
            your base
          </text>
          <text x={W / 2} y={11} textAnchor="middle" className="fill-muted text-[10px]">
            enemy base
          </text>
          {deaths.map((d, i) => {
            const mine = d.accountId === highlight
            return (
              <circle
                key={i}
                cx={sx(d.pos[0])}
                cy={sy(d.pos[1])}
                r={mine ? 5.5 : 4}
                fill={d.ours ? 'var(--color-loss)' : 'var(--color-win)'}
                fillOpacity={0.75}
                stroke={mine ? 'var(--color-ink)' : 'none'}
                strokeWidth={1.5}
              >
                <title>
                  {`${formatDuration(d.t)} · ${heroOf(heroes, d.heroId).name} died${d.killerHeroId != null ? ` to ${heroOf(heroes, d.killerHeroId).name}` : ''}`}
                </title>
              </circle>
            )
          })}
        </svg>
        <div className="grid content-start gap-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-loss" /> your team died
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-win" /> enemy died
          </span>
          {highlight != null && (
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-ink" /> your own deaths
            </span>
          )}
          <p className="pt-2">Bars are lanes, the dashed line is the middle of the map. Deaths above it happened on the enemy's side. Hover a dot for details.</p>
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ review by area

export function AreaReview({ analysis, accountId, title }: { analysis: MatchAnalysis; accountId: number | null; title: string }) {
  const report = accountId != null ? analysis.players.find((r) => r.accountId === accountId) : undefined
  const findings: Finding[] = report ? report.findings : [...analysis.wentWrong, ...analysis.wentRight]
  const byArea = AREA_ORDER.map((area) => ({ area, list: findings.filter((f) => f.area === area).sort((a, b) => b.weight - a.weight) })).filter((g) => g.list.length)
  return (
    <Card title={title}>
      {byArea.length === 0 ? (
        <p className="p-4 text-sm text-muted">Nothing flagged.</p>
      ) : (
        <div className="grid gap-px bg-line md:grid-cols-2">
          {byArea.map(({ area, list }) => (
            <section key={area} className="bg-surface p-4">
              <div className="mb-2.5 text-xs font-medium text-muted">{AREA_LABEL[area]}</div>
              <ul className="grid gap-2.5">
                {list.map((f) => (
                  <li key={f.title} className="flex gap-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[f.tone]}`} aria-hidden />
                    <div className="min-w-0">
                      <div className="text-sm">{f.title}</div>
                      {f.detail && <div className="text-xs text-muted">{f.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}
