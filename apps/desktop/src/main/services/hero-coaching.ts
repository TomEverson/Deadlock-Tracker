import { db as getDb } from '../db'
import { matchDetailSchema } from '@deadlock/core/domain/matches/validators/match-detail'
import { coachHero, type HeroCoachingResult } from '@deadlock/core/domain/players/services/hero-coaching'

export type { HeroCoachingResult } from '@deadlock/core/domain/players/services/hero-coaching'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import { fetchHeroStats, fetchItemStats, fetchPlayerMetrics } from './deadlock-api'
import { getHeroMap, getItemMap, getRankInfo, heroOrFallback } from './assets'
import { listPlayerMatches } from './player-repo'

// Hero-by-hero coaching for one player: their numbers on each hero they play
// vs top players of that hero (Ascendant+, deadlock-api analytics), plus their
// builds (local match details) vs what top players buy.

const MIN_GAMES = 3
const MAX_HEROES = 6
const WINDOW_DAYS = 30
const CACHE_MS = 60 * 60 * 1000
/** Top players: Ascendant 1 and up (badge = tier * 10 + subrank). */
const TOP_MIN_BADGE = 101
/** Widen to Phantom+ for heroes with too few top games in the window. */
const WIDE_MIN_BADGE = 91
const MIN_TOP_GAMES = 1500
const MAX_BADGE = 116
const cache = new Map<number, { at: number; value: Promise<HeroCoachingResult> }>()

async function build(accountId: number): Promise<HeroCoachingResult> {
  const [rows, heroMap, itemMap] = await Promise.all([listPlayerMatches(accountId), getHeroMap().catch(() => new Map<number, HeroInfo>()), getItemMap().catch(() => new Map<number, ItemInfo>())])

  // Local details: lobby players (for the bracket) and this player's builds per hero.
  const detailRows = rows.length
    ? await getDb()
        .selectFrom('matchDetail')
        .select(['data'])
        .where(
          'matchId',
          'in',
          rows.map((r) => r.matchId),
        )
        .execute()
    : []
  const builds = new Map<number, Map<number, number>[]>()
  for (const r of detailRows) {
    let parsed
    try {
      parsed = matchDetailSchema.safeParse(JSON.parse(r.data))
    } catch {
      continue
    }
    if (!parsed.success) continue
    const me = parsed.data.players.find((p) => p.accountId === accountId)
    if (!me) continue
    const firstBuy = new Map<number, number>()
    for (const it of me.items) if (!firstBuy.has(it.itemId)) firstBuy.set(it.itemId, it.t)
    builds.set(me.heroId, [...(builds.get(me.heroId) ?? []), firstBuy])
  }

  const byHero = new Map<number, { games: number; wins: number }>()
  for (const r of rows) {
    const h = byHero.get(r.heroId) ?? { games: 0, wins: 0 }
    h.games++
    if (r.won === 1) h.wins++
    byHero.set(r.heroId, h)
  }
  const heroes = [...byHero.entries()]
    .filter(([, h]) => h.games >= MIN_GAMES)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, MAX_HEROES)

  const heroInfo: Record<number, HeroInfo> = {}
  for (const [id] of heroes) heroInfo[id] = heroOrFallback(heroMap, id)
  const benchmark = { minBadge: TOP_MIN_BADGE, maxBadge: MAX_BADGE, rank: await getRankInfo(TOP_MIN_BADGE), windowDays: WINDOW_DAYS }
  if (heroes.length === 0) return { benchmark, heroes: [], heroInfo, items: {}, error: null }

  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400
  const pool = (minBadge: number) => ({ match_mode: 'ranked', game_mode: 'normal', min_average_badge: minBadge, max_average_badge: MAX_BADGE, min_unix_timestamp: since })
  const [topTotals, wideTotals] = await Promise.all([fetchHeroStats(pool(TOP_MIN_BADGE)), fetchHeroStats(pool(WIDE_MIN_BADGE))])
  // Per hero: Ascendant+ when there's enough of it, else Phantom+.
  const poolFor = (heroId: number) => ((topTotals.find((t) => t.hero_id === heroId)?.matches ?? 0) >= MIN_TOP_GAMES ? TOP_MIN_BADGE : WIDE_MIN_BADGE)

  const isShopItem = (id: number) => {
    const i = itemMap.get(id)
    return !!i && i.slot !== 'other' && (i.cost ?? 0) > 0
  }
  const coached = await Promise.all(
    heroes.map(async ([heroId, h]) => {
      const minBadge = poolFor(heroId)
      const [bench, you, benchItems] = await Promise.all([
        fetchPlayerMetrics({ ...pool(minBadge), hero_ids: String(heroId), include_buff_metrics: true }),
        // You: all your games on the hero (ranked or not).
        fetchPlayerMetrics({ hero_ids: String(heroId), account_ids: String(accountId), match_mode: 'ranked,unranked', game_mode: 'normal', include_buff_metrics: true }),
        fetchItemStats({ ...pool(minBadge), hero_id: heroId }).catch(() => []),
      ])
      return coachHero(
        {
          heroId,
          heroName: heroInfo[heroId]!.name,
          games: h.games,
          wins: h.wins,
          bench,
          you,
          benchItems,
          yourBuilds: builds.get(heroId) ?? [],
          isShopItem,
          itemName: (id) => itemMap.get(id)?.name ?? `Item ${id}`,
        },
        minBadge === TOP_MIN_BADGE ? topTotals : wideTotals,
      )
    }),
  )

  const items: Record<number, ItemInfo> = {}
  for (const c of coached) for (const b of c.build) if (itemMap.has(b.itemId)) items[b.itemId] = itemMap.get(b.itemId)!
  return { benchmark, heroes: coached, heroInfo, items, error: null }
}

/** Cached for an hour per player (the API's analytics are cached server-side for an hour too). */
export function getHeroCoaching(accountId: number): Promise<HeroCoachingResult> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = build(accountId).catch((err): HeroCoachingResult => {
    cache.delete(accountId)
    return { benchmark: { minBadge: TOP_MIN_BADGE, maxBadge: MAX_BADGE, rank: null, windowDays: WINDOW_DAYS }, heroes: [], heroInfo: {}, items: {}, error: err instanceof Error ? err.message : String(err) }
  })
  cache.set(accountId, { at: Date.now(), value })
  return value
}
