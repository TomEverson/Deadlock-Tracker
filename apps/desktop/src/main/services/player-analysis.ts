import { db as getDb } from '../db'
import { matchDetailSchema, type MatchDetailData } from '@deadlock/core/domain/matches/validators/match-detail'
import { overallAnalysis, referencedIds, type PlayerAnalysisResult } from '@deadlock/core/domain/players/services/overall-analysis'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import { getHeroMap, getItemMap, heroOrFallback } from './assets'
import { listPlayerMatches } from './player-repo'

// Cross-match analysis for one player, computed here (the details are
// already in the local database) so only the small summary crosses IPC.

/** Detailed games analyzed per request, newest first. */
const MAX_DETAILED = 100

export async function buildPlayerAnalysis(accountId: number): Promise<PlayerAnalysisResult> {
  const rows = await listPlayerMatches(accountId)
  const ids = rows.slice(0, MAX_DETAILED).map((r) => r.matchId)
  const detailRows = ids.length ? await getDb().selectFrom('matchDetail').select(['data']).where('matchId', 'in', ids).execute() : []
  const details: MatchDetailData[] = []
  for (const r of detailRows) {
    try {
      const parsed = matchDetailSchema.safeParse(JSON.parse(r.data))
      if (parsed.success) details.push(parsed.data)
    } catch {
      // unreadable row: skip it
    }
  }
  const [heroMap, itemMap] = await Promise.all([getHeroMap().catch(() => new Map<number, HeroInfo>()), getItemMap().catch(() => new Map<number, ItemInfo>())])
  const analysis = overallAnalysis({
    accountId,
    games: rows.map((r) => ({
      matchId: r.matchId,
      startTime: r.startTime,
      durationS: r.durationS,
      won: r.won === 1,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      netWorth: r.netWorth,
      heroId: r.heroId,
    })),
    details,
    heroName: (id) => heroMap.get(id)?.name ?? `Hero ${id}`,
    items: Object.fromEntries(itemMap),
  })
  const refs = referencedIds(analysis)
  return {
    ...analysis,
    heroInfo: Object.fromEntries(refs.heroes.map((id) => [id, heroOrFallback(heroMap, id)])),
    items: Object.fromEntries(refs.items.flatMap((id) => (itemMap.has(id) ? [[id, itemMap.get(id)!]] : []))),
  }
}
