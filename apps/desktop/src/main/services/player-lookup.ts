import { fetchMateStats, fetchSteamProfiles, searchSteamProfiles } from './deadlock-api'
import { getRankInfo } from './assets'
import type { Friend, FriendList, Mate, PlayerSearchResult } from '@deadlock/core/domain/players/types'
import { listFriends } from './player-repo'

const MAX_MATES = 8

export async function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
  const results = await searchSteamProfiles(query, 12)
  return results.map((r) => ({
    accountId: r.account_id,
    name: r.personaname ?? `Player ${r.account_id}`,
    avatar: r.avatarmedium ?? null,
  }))
}

export async function getMates(accountId: number): Promise<Mate[]> {
  const stats = await fetchMateStats(accountId)
  const top = stats.sort((a, b) => b.matches_played - a.matches_played).slice(0, MAX_MATES)
  const profiles = await fetchSteamProfiles(top.map((m) => m.mate_id)).catch(() => [])
  const byId = new Map(profiles.map((p) => [p.account_id, p]))
  return top.map((m) => {
    const p = byId.get(m.mate_id)
    return {
      accountId: m.mate_id,
      name: p?.personaname ?? `Player ${m.mate_id}`,
      avatar: p?.avatarmedium ?? null,
      games: m.matches_played,
      wins: m.wins,
    }
  })
}

export async function getFriends(): Promise<FriendList> {
  const all = await listFriends()
  const selfRow = all.find((r) => r.isSelf === 1)
  const rows = all.filter((r) => r.isSelf !== 1)
  const played = rows.filter((r) => Number(r.games) > 0)
  const toFriend = async (r: (typeof all)[number]): Promise<Friend> => ({
    accountId: r.accountId,
    name: r.personaName ?? `Player ${r.accountId}`,
    avatar: r.avatarUrl,
    rank: await getRankInfo(r.rankBadge),
    games: Number(r.games),
    wins: Number(r.wins),
    lastMatchAt: r.lastMatchAt == null ? null : Number(r.lastMatchAt),
  })
  const [self, friends] = await Promise.all([selfRow ? toFriend(selfRow) : null, Promise.all(played.map(toFriend))])
  friends.sort((a, b) => (b.lastMatchAt ?? 0) - (a.lastMatchAt ?? 0))
  return { self, friends, withoutMatches: rows.length - played.length }
}
