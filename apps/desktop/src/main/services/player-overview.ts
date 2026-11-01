import { getHeroMap, getRankInfo, heroOrFallback } from './assets'
import { modeLabel } from '@deadlock/core/lib/format'
import type { HeroStatRow, PlayerMatchRow, PlayerOverview, PlayerSummary } from '@deadlock/core/domain/players/types'
import { getPlayerRow, listPlayerMatches } from './player-repo'

const MAX_MATCH_ROWS = 300
const FORM_LENGTH = 10

export async function buildPlayerOverview(accountId: number): Promise<PlayerOverview> {
  const [player, rows, heroMap] = await Promise.all([
    getPlayerRow(accountId),
    listPlayerMatches(accountId),
    getHeroMap().catch(() => new Map()),
  ])
  const rank = await getRankInfo(player?.rankBadge)

  const summary: PlayerSummary = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, avgNetWorth: 0, avgDurationS: 0, recentForm: [] }
  const heroAgg = new Map<number, Omit<HeroStatRow, 'hero' | 'avgNetWorth'> & { netWorth: number }>()
  let totalNetWorth = 0
  let totalDuration = 0

  for (const r of rows) {
    const won = r.won === 1
    summary.games++
    if (won) summary.wins++
    summary.kills += r.kills
    summary.deaths += r.deaths
    summary.assists += r.assists
    totalNetWorth += r.netWorth
    totalDuration += r.durationS
    if (summary.recentForm.length < FORM_LENGTH) summary.recentForm.push(won)

    const h = heroAgg.get(r.heroId) ?? { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, netWorth: 0, lastPlayed: 0 }
    h.games++
    if (won) h.wins++
    h.kills += r.kills
    h.deaths += r.deaths
    h.assists += r.assists
    h.netWorth += r.netWorth
    h.lastPlayed = Math.max(h.lastPlayed, r.startTime)
    heroAgg.set(r.heroId, h)
  }
  summary.avgNetWorth = summary.games ? totalNetWorth / summary.games : 0
  summary.avgDurationS = summary.games ? totalDuration / summary.games : 0

  const heroes: HeroStatRow[] = [...heroAgg.entries()]
    .map(([heroId, h]) => ({
      hero: heroOrFallback(heroMap, heroId),
      games: h.games,
      wins: h.wins,
      kills: h.kills,
      deaths: h.deaths,
      assists: h.assists,
      avgNetWorth: h.netWorth / h.games,
      lastPlayed: h.lastPlayed,
    }))
    .sort((a, b) => b.games - a.games || b.lastPlayed - a.lastPlayed)

  const matches: PlayerMatchRow[] = rows.slice(0, MAX_MATCH_ROWS).map((r) => ({
    matchId: r.matchId,
    hero: heroOrFallback(heroMap, r.heroId),
    startTime: r.startTime,
    durationS: r.durationS,
    won: r.won === 1,
    abandoned: r.abandonedTimeS > 0,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    netWorth: r.netWorth,
    lastHits: r.lastHits,
    denies: r.denies,
    level: r.heroLevel,
    mode: modeLabel(r.gameMode, r.matchMode),
  }))

  return {
    profile: {
      accountId,
      name: player?.personaName ?? `Player ${accountId}`,
      avatar: player?.avatarUrl ?? null,
      profileUrl: player?.profileUrl ?? null,
    },
    rank,
    freshness: {
      lastSyncedAt: player?.lastSyncedAt ?? null,
      latestMatchAt: rows[0]?.startTime ?? null,
    },
    summary,
    heroes,
    matches,
    totalMatches: rows.length,
  }
}
