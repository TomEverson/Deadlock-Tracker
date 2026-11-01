import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import { Avatar, HeroIcon, RankBadge } from '~/components/ui'
import type { HeroInfo, ItemInfo, RankInfo } from '@deadlock/core/domain/assets/types'
import { formatDuration, formatSouls, teamName } from '@deadlock/core/lib/format'
import type { PlayerReport } from '@deadlock/core/domain/matches/services/analysis'
import type { MatchDetailData, MatchDetailPlayer } from '@deadlock/core/domain/matches/validators/match-detail'
import { GradeBadge } from './MatchAnalysis'
import { ItemBuildBody } from './ItemBuild'
import { ItemHover, SLOT_COLOR } from './ItemHover'

const COLUMNS = 10

function fmt(n: number | null): string {
  return n == null ? '—' : formatSouls(n)
}


/** Items held at the end of the match, in purchase order. */
function FinalItems({ player, items }: { player: MatchDetailPlayer; items: Record<number, ItemInfo> }) {
  const final = player.items
    .filter((i) => i.soldAt === null)
    .sort((a, b) => a.t - b.t)
    .flatMap((i) => {
      const info = items[i.itemId]
      return info ? [{ ...i, info }] : []
    })
  if (final.length === 0) return <span className="text-xs text-muted">—</span>
  return (
    <div className="flex w-[10.5rem] flex-wrap gap-0.5">
      {final.map((i) => (
        <ItemHover key={`${i.itemId}-${i.t}`} item={i.info} meta={<>Bought at <span className="num text-ink-2">{formatDuration(i.t)}</span></>}>
          <span className="grid h-6 w-6 place-items-center rounded-sm bg-surface-2 hover:bg-line-strong" style={{ boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[i.info.slot]}` }}>
            {i.info.icon ? <img src={i.info.icon} alt={i.info.name} width={18} height={18} loading="lazy" /> : <span className="text-[7px] leading-none text-ink-2">{i.info.name.slice(0, 3)}</span>}
          </span>
        </ItemHover>
      ))}
    </div>
  )
}

function TeamTable({
  team,
  players,
  won,
  heroes,
  items,
  rank,
  selected,
  onSelect,
  reports,
}: {
  team: number
  players: MatchDetailPlayer[]
  won: boolean
  heroes: Record<number, HeroInfo>
  items: Record<number, ItemInfo>
  rank: RankInfo | null
  selected: number | null
  onSelect: (accountId: number) => void
  reports: Map<number, PlayerReport>
}) {
  const color = team === 0 ? 'var(--color-team0)' : 'var(--color-team1)'
  return (
    <section className="card overflow-hidden">
      <header className="flex min-h-10 items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <h2 className="text-sm font-medium">{teamName(team)}</h2>
          <span className={`text-xs ${won ? 'text-win' : 'text-loss'}`}>{won ? 'Victory' : 'Defeat'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="hidden sm:inline">Avg rank</span>
          <RankBadge rank={rank} size={16} />
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Player</th>
              <th className="px-2 py-2 text-right font-normal">K / D / A</th>
              <th className="px-2 py-2 text-right font-normal">Souls</th>
              <th className="px-2 py-2 text-right font-normal">LH / DN</th>
              <th className="px-2 py-2 text-right font-normal">Hero dmg</th>
              <th className="px-2 py-2 text-right font-normal">Dmg taken</th>
              <th className="px-2 py-2 text-right font-normal">Obj dmg</th>
              <th className="px-2 py-2 text-right font-normal">Healing</th>
              <th className="px-4 py-2 font-normal">Items</th>
              <th className="w-6 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {players.map((p) => {
              const hero = heroes[p.heroId] ?? { id: p.heroId, name: `Hero ${p.heroId}`, icon: null, card: null }
              const isSel = p.accountId === selected
              const report = reports.get(p.accountId)
              return (
                <Fragment key={p.accountId}>
                  <tr
                    className={`cursor-pointer ${isSel ? 'bg-surface-2' : 'hover:bg-surface-2/70'}`}
                    onClick={() => onSelect(p.accountId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(p.accountId)
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={isSel}
                    title={isSel ? 'Hide build' : 'Show build'}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <HeroIcon hero={hero} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Link
                              to="/players/$accountId"
                              params={{ accountId: p.accountId }}
                              onClick={(e) => e.stopPropagation()}
                              className={`block max-w-[10rem] truncate font-medium hover:underline ${isSel ? 'text-ink' : 'text-ink'}`}
                            >
                              {p.name}
                            </Link>
                            {report && <GradeBadge grade={report.grade} size="sm" />}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted">
                            <Avatar src={p.avatar} name={p.name} size={12} />
                            {hero.name} · lvl {p.level}
                            {p.abandonedAtS ? <span className="text-loss">· left</span> : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num px-2 text-right">
                      {p.kills}<span className="text-muted"> / </span>{p.deaths}<span className="text-muted"> / </span>{p.assists}
                    </td>
                    <td className="num px-2 text-right">{formatSouls(p.netWorth)}</td>
                    <td className="num px-2 text-right text-ink-2">{p.lastHits} / {p.denies}</td>
                    <td className="num px-2 text-right">{fmt(p.damage)}</td>
                    <td className="num px-2 text-right text-ink-2">{fmt(p.damageTaken)}</td>
                    <td className="num px-2 text-right text-ink-2">{fmt(p.objectiveDamage)}</td>
                    <td className="num px-2 text-right text-ink-2">{fmt(p.healing)}</td>
                    <td className="px-4 py-1.5">
                      <FinalItems player={p} items={items} />
                    </td>
                    <td className="pr-3 text-muted" aria-hidden>
                      <span className={`inline-block transition-transform ${isSel ? 'rotate-90' : ''}`}>›</span>
                    </td>
                  </tr>
                  {isSel && (
                    <tr className="bg-surface-2/40">
                      <td colSpan={COLUMNS} className="px-4 py-4">
                        <ItemBuildBody player={p} items={items} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Scoreboard({
  detail,
  heroes,
  items,
  avgRank,
  selected,
  onSelect,
  reports,
}: {
  detail: MatchDetailData
  heroes: Record<number, HeroInfo>
  items: Record<number, ItemInfo>
  avgRank: [RankInfo | null, RankInfo | null]
  selected: number | null
  onSelect: (accountId: number) => void
  reports: Map<number, PlayerReport>
}) {
  return (
    <div className="grid gap-4">
      {[0, 1].map((team) => (
        <TeamTable
          key={team}
          team={team}
          players={detail.players.filter((p) => p.team === team).sort((a, b) => b.netWorth - a.netWorth)}
          won={detail.winningTeam === team}
          heroes={heroes}
          items={items}
          rank={avgRank[team] ?? null}
          selected={selected}
          onSelect={onSelect}
          reports={reports}
        />
      ))}
    </div>
  )
}
