import { useState } from 'react'
import { Card, HeroIcon } from '~/components/ui'
import { formatDuration } from '@deadlock/core/lib/format'
import type { HeroInfo } from '@deadlock/core/domain/assets/types'
import type { PlayerAnalysisResult } from '@deadlock/core/domain/players/services/overall-analysis'
import type { HeroSummary, ItemTiming } from '@deadlock/core/domain/players/services/player-heroes'
import type { HeroCoachingResult } from '@deadlock/core/domain/players/services/hero-coaching'
import { ItemHover, SLOT_COLOR } from '~/domain/matches/components/ItemHover'
import { HeroCoachingCards } from './HeroCoachingView'

// The Heroes tab: every hero you played from your own games, then for the
// selected hero your matchups and item timings, and the comparison with top players.

const pct = (x: number) => `${Math.round(x * 100)}%`
const heroOf = (info: Record<number, HeroInfo>, id: number): HeroInfo => info[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }

function HeroList({ heroes, info, selected, onSelect }: { heroes: HeroSummary[]; info: Record<number, HeroInfo>; selected: number; onSelect: (id: number) => void }) {
  return (
    <Card title="Your heroes">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Hero</th>
              <th className="px-2 py-2 text-right font-normal">Games</th>
              <th className="px-2 py-2 text-right font-normal">Win rate</th>
              <th className="px-2 py-2 text-right font-normal">KDA</th>
              <th className="px-2 py-2 text-right font-normal">Deaths</th>
              <th className="px-2 py-2 text-right font-normal">Souls/min</th>
              <th className="px-2 py-2 text-right font-normal" title="Lanes won–lost by 500+ souls at the end of laning (detailed games)">
                Lanes
              </th>
              <th className="px-2 py-2 text-right font-normal" title="Your end-of-game souls vs the lobby median (detailed games)">
                Souls vs lobby
              </th>
              <th className="px-4 py-2 text-right font-normal" title="0–100 impact score in the lobby (detailed games)">
                Impact
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {heroes.map((h) => {
              const wr = h.wins / h.games
              const active = h.heroId === selected
              return (
                <tr key={h.heroId} onClick={() => onSelect(h.heroId)} className={`cursor-pointer ${active ? 'bg-accent/10' : 'hover:bg-surface-2'}`}>
                  <td className="px-4 py-1.5">
                    <button type="button" aria-pressed={active} className="flex items-center gap-2 text-left font-medium" onClick={() => onSelect(h.heroId)}>
                      <HeroIcon hero={heroOf(info, h.heroId)} size={24} />
                      {heroOf(info, h.heroId).name}
                    </button>
                  </td>
                  <td className="num px-2 py-1.5 text-right text-ink-2">{h.games}</td>
                  <td className={`num px-2 py-1.5 text-right ${wr >= 0.5 ? 'text-win' : 'text-loss'}`} title={`${h.wins}–${h.games - h.wins}`}>
                    {pct(wr)}
                  </td>
                  <td className="num px-2 py-1.5 text-right text-ink-2">{h.kda.toFixed(1)}</td>
                  <td className="num px-2 py-1.5 text-right text-ink-2">{h.deaths.toFixed(1)}</td>
                  <td className="num px-2 py-1.5 text-right text-ink-2">{Math.round(h.soulsPerMin)}</td>
                  <td className="num px-2 py-1.5 text-right text-ink-2">{h.laneGames ? `${h.laneWon}–${h.laneLost}` : '–'}</td>
                  <td className={`num px-2 py-1.5 text-right ${h.soulsVsLobby == null ? 'text-muted' : h.soulsVsLobby >= 1.1 ? 'text-win' : h.soulsVsLobby <= 0.9 ? 'text-loss' : 'text-ink-2'}`}>
                    {h.soulsVsLobby == null ? '–' : pct(h.soulsVsLobby)}
                  </td>
                  <td className="num px-4 py-1.5 text-right text-ink-2">{h.impact == null ? '–' : Math.round(h.impact)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Click a hero for its matchups, item timings and comparison with top players. Lanes, souls vs lobby and impact use games with full details.</p>
    </Card>
  )
}

function MatchupList({ title, rows, info, empty }: { title: string; rows: { heroId: number; text: string; tone: 'good' | 'bad' | 'info' }[]; info: Record<number, HeroInfo>; empty: string }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((r) => (
            <li key={r.heroId} className="flex items-center gap-2 text-sm">
              <HeroIcon hero={heroOf(info, r.heroId)} size={22} />
              <span className="min-w-0 flex-1 truncate">{heroOf(info, r.heroId).name}</span>
              <span className={`num text-xs ${r.tone === 'good' ? 'text-win' : r.tone === 'bad' ? 'text-loss' : 'text-ink-2'}`}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TimingRow({ t, analysis }: { t: ItemTiming; analysis: PlayerAnalysisResult }) {
  const item = analysis.items[t.itemId]
  const gap = t.lossS - t.winS
  const icon = (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-surface-2" style={item ? { boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[item.slot]}` } : undefined}>
      {item?.icon ? <img src={item.icon} alt="" width={24} height={24} loading="lazy" /> : null}
    </span>
  )
  // Name on top, times underneath: a narrow column never makes them overlap.
  return (
    <li className="flex items-center gap-2.5">
      {item ? (
        <ItemHover item={item} meta={<>{`First bought around ${formatDuration(t.winS)} in ${t.wins} wins, ${formatDuration(t.lossS)} in ${t.losses} losses.`}</>}>
          {icon}
        </ItemHover>
      ) : (
        icon
      )}
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm">{item?.name ?? `Item ${t.itemId}`}</span>
        <span className="num truncate text-xs">
          <span className="text-win">{formatDuration(t.winS)}</span>
          <span className="text-muted"> vs </span>
          <span className="text-loss">{formatDuration(t.lossS)}</span>
          <span className="text-muted">
            {' '}
            ({gap > 0 ? '+' : '−'}
            {formatDuration(Math.abs(gap))} in losses)
          </span>
        </span>
      </span>
    </li>
  )
}

function HeroGames({ hero, analysis }: { hero: HeroSummary; analysis: PlayerAnalysisResult }) {
  const info = analysis.heroInfo
  const name = heroOf(info, hero.heroId).name
  if (hero.detailed === 0)
    return (
      <Card title={`Your ${name} games`}>
        <p className="p-4 text-sm text-muted">None of your {name} games have full details yet, so there are no matchups or item timings.</p>
      </Card>
    )
  const hard = hero.matchups.filter((m) => m.wins / m.games < 0.5).slice(0, 5)
  const easy = [...hero.matchups]
    .filter((m) => m.wins / m.games > 0.5)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)
    .slice(0, 5)
  const lanes = hero.laneMatchups.slice(0, 6)
  const later = hero.itemTiming.filter((t) => t.lossS > t.winS).slice(0, 6)
  return (
    <Card
      title={`Your ${name} games`}
      right={
        <span className="num text-xs text-muted">
          {hero.wins}–{hero.games - hero.wins} · {hero.detailed} with details
        </span>
      }
    >
      <div className="grid gap-6 p-4 md:grid-cols-2 xl:grid-cols-4">
        <MatchupList
          title="Hardest enemies"
          info={info}
          empty="No enemy hero you lose to more often than not (2+ games)."
          rows={hard.map((m) => ({ heroId: m.heroId, text: `${m.wins}–${m.games - m.wins}`, tone: 'bad' as const }))}
        />
        <MatchupList
          title="Easiest enemies"
          info={info}
          empty="No enemy hero you beat more often than not yet (2+ games)."
          rows={easy.map((m) => ({ heroId: m.heroId, text: `${m.wins}–${m.games - m.wins}`, tone: 'good' as const }))}
        />
        <MatchupList
          title="Lane opponents (lanes won–lost)"
          info={info}
          empty="No lane opponent faced twice yet."
          rows={lanes.map((m) => ({ heroId: m.heroId, text: `${m.won}–${m.lost} of ${m.games}`, tone: m.lost > m.won ? ('bad' as const) : m.won > m.lost ? ('good' as const) : ('info' as const) }))}
        />
        <div>
          <div className="mb-2 text-xs font-medium text-muted" title="Median first buy time of the same item in your wins vs your losses">
            Item timing: <span className="text-win">wins</span> vs <span className="text-loss">losses</span>
          </div>
          {later.length === 0 ? (
            <p className="text-xs text-muted">No item you get much later in losses (needs 2+ wins and 2+ losses with it).</p>
          ) : (
            <ul className="grid gap-2">
              {later.map((t) => (
                <TimingRow key={t.itemId} t={t} analysis={analysis} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Matchups count every enemy {name} faced, 2+ games. Item timing compares when you got the same item in wins and losses. Losing games are poorer, so some delay is
        normal: a gap of several minutes on a core item means you should prioritize it. Based on {hero.detailed} games with details; small samples.
      </p>
    </Card>
  )
}

function Coaching({ coaching, heroId, name }: { coaching: HeroCoachingResult | null | 'loading'; heroId: number; name: string }) {
  if (coaching === 'loading') return <p className="text-sm text-muted">Comparing your {name} with top players…</p>
  if (!coaching || coaching.error) return <p className="text-sm text-muted">Couldn't load top-player benchmarks{coaching?.error ? `: ${coaching.error}` : ''}.</p>
  const hero = coaching.heroes.find((h) => h.heroId === heroId)
  if (!hero) return <p className="text-sm text-muted">The comparison with top players covers your {coaching.heroes.length || 6} most played heroes with at least 3 games.</p>
  return <HeroCoachingCards result={coaching} hero={hero} />
}

export function HeroesSection({ analysis, coaching }: { analysis: PlayerAnalysisResult; coaching: HeroCoachingResult | null | 'loading' }) {
  const [selected, setSelected] = useState<number | null>(null)
  const hero = analysis.heroes.find((h) => h.heroId === selected) ?? analysis.heroes[0]
  if (!hero) return <p className="text-sm text-muted">No games yet.</p>
  return (
    <div className="grid gap-4">
      <HeroList heroes={analysis.heroes} info={analysis.heroInfo} selected={hero.heroId} onSelect={setSelected} />
      <h2 className="flex items-center gap-2 pt-2 text-base font-medium">
        <HeroIcon hero={heroOf(analysis.heroInfo, hero.heroId)} size={26} />
        {heroOf(analysis.heroInfo, hero.heroId).name}
      </h2>
      <HeroGames hero={hero} analysis={analysis} />
      <Coaching coaching={coaching} heroId={hero.heroId} name={heroOf(analysis.heroInfo, hero.heroId).name} />
    </div>
  )
}
