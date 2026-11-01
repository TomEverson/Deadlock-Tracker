import { db as getDb } from '../db'
import { HERO_COUNTERS } from '@deadlock/core/domain/matches/data/hero-counters'
import { cloudDetailsSource } from '../cloud/sync'
import { fetchSteamProfiles } from './deadlock-api'
import { getSelfAccountId } from './player-repo'
import { getHeroMap, getItemMap, getRankInfo, heroOrFallback } from './assets'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import { matchDetailSchema, type MatchDetailData } from '@deadlock/core/domain/matches/validators/match-detail'
import type { MatchDetailResult } from '@deadlock/core/domain/matches/types'

async function loadCached(matchId: number): Promise<MatchDetailData | null> {
  const row = await getDb().selectFrom('matchDetail').select('data').where('matchId', '=', matchId).executeTakeFirst()
  if (!row) return null
  let json: unknown
  try {
    json = JSON.parse(row.data)
  } catch {
    return null
  }
  const parsed = matchDetailSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

const isPlaceholderName = (p: { accountId: number; name: string }) => p.name === `Player ${p.accountId}`

/**
 * Steam doesn't always return personas for non-friends during sync, so
 * some players are stored as "Player <id>". Fill those from the local player
 * table, then deadlock-api's Steam-profile lookup, and save the result so it
 * only happens once per match.
 */
async function fillMissingNames(detail: MatchDetailData): Promise<MatchDetailData> {
  const missing = detail.players.filter(isPlaceholderName).map((p) => p.accountId)
  if (missing.length === 0) return detail

  const found = new Map<number, { name: string; avatar: string | null }>()
  const local = await getDb().selectFrom('player').select(['accountId', 'personaName', 'avatarUrl']).where('accountId', 'in', missing).execute()
  for (const r of local) if (r.personaName) found.set(r.accountId, { name: r.personaName, avatar: r.avatarUrl })

  const stillMissing = missing.filter((id) => !found.has(id))
  if (stillMissing.length > 0) {
    const profiles = await fetchSteamProfiles(stillMissing).catch(() => [])
    for (const p of profiles) if (p.personaname) found.set(p.account_id, { name: p.personaname, avatar: p.avatarmedium ?? null })
  }
  if (found.size === 0) return detail

  const patched: MatchDetailData = {
    ...detail,
    players: detail.players.map((p) => {
      const f = isPlaceholderName(p) ? found.get(p.accountId) : undefined
      return f ? { ...p, name: f.name, avatar: p.avatar ?? f.avatar } : p
    }),
  }
  await getDb().updateTable('matchDetail').set({ data: JSON.stringify(patched) }).where('matchId', '=', detail.matchId).execute()
  return patched
}

// The page shouldn't sit on a spinner while a flaky cloud is unreachable; a
// missed detail just falls through to the explicit Steam download button.
const CLOUD_DETAIL_WAIT_MS = 6000

async function pullFromCloud(matchId: number): Promise<boolean> {
  const pull = cloudDetailsSource()
    .pull([matchId])
    .catch(() => new Set<number>())
  const timeout = new Promise<Set<number>>((resolve) => {
    setTimeout(() => resolve(new Set()), CLOUD_DETAIL_WAIT_MS).unref()
  })
  return (await Promise.race([pull, timeout])).has(matchId)
}

export async function getMatchDetail(matchId: number): Promise<MatchDetailResult> {
  // Local first. If it's missing, the group may already have it in D1 — pulling
  // from the cloud costs no Steam request. Only when neither has it does the
  // page offer an explicit Steam download.
  let cached = await loadCached(matchId)
  if (!cached && (await pullFromCloud(matchId))) {
    cached = await loadCached(matchId)
  }
  if (!cached) {
    return {
      kind: 'unavailable',
      message: "This match's details aren't in the cloud yet. Download them from Steam when you want the full scoreboard.",
    }
  }

  const [detail, selfAccountId] = await Promise.all([fillMissingNames(cached).catch(() => cached), getSelfAccountId()])

  const [heroMap, itemMap, rank0, rank1] = await Promise.all([
    getHeroMap().catch(() => new Map<number, HeroInfo>()),
    getItemMap().catch(() => new Map<number, ItemInfo>()),
    getRankInfo(detail.avgBadge[0]),
    getRankInfo(detail.avgBadge[1]),
  ])

  // Only ship the heroes/items this match actually uses, plus every counter
  // item (hero counter lists, anti-heal/resist/shred tags) so the Counters
  // tab can show items nobody bought and suggest the cheapest options.
  // Item ids that aren't shop upgrades (ability unlocks etc.) are dropped here.
  const heroes: Record<number, HeroInfo> = {}
  const items: Record<number, ItemInfo> = {}
  for (const p of detail.players) {
    heroes[p.heroId] = heroOrFallback(heroMap, p.heroId)
    for (const i of p.items) {
      const info = itemMap.get(i.itemId)
      if (info) items[i.itemId] = info
    }
  }
  const counterNames = new Set(Object.values(HERO_COUNTERS).flat())
  for (const info of itemMap.values()) {
    if (items[info.id]) continue
    if (info.tags.length > 0 || (counterNames.has(info.name) && info.icon)) items[info.id] = info
  }

  return { kind: 'ok', detail, heroes, items, avgRank: [rank0, rank1], selfAccountId }
}
