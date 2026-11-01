import { db as getDb } from '../db'

export async function ensurePlayer(accountId: number): Promise<void> {
  await getDb()
    .insertInto('player')
    .values({ accountId, createdAt: new Date().toISOString() })
    .onConflict((oc) => oc.column('accountId').doNothing())
    .execute()
}

export async function markViewed(accountId: number): Promise<void> {
  await ensurePlayer(accountId)
  await getDb().updateTable('player').set({ lastViewedAt: new Date().toISOString() }).where('accountId', '=', accountId).execute()
}

export function getPlayerRow(accountId: number) {
  return getDb().selectFrom('player').selectAll().where('accountId', '=', accountId).executeTakeFirst()
}


export function listPlayerMatches(accountId: number) {
  return getDb()
    .selectFrom('playerMatch')
    .selectAll()
    .where('accountId', '=', accountId)
    .orderBy('startTime', 'desc')
    .execute()
}



/** You + your Steam friends (as of the last sync) with their stored match totals. */
export function listFriends() {
  return getDb()
    .selectFrom('player')
    .leftJoin('playerMatch', 'playerMatch.accountId', 'player.accountId')
    .select((eb) => [
      'player.accountId',
      'player.personaName',
      'player.avatarUrl',
      'player.rankBadge',
      'player.isSelf',
      'player.lastSyncedAt',
      eb.fn.count<number>('playerMatch.matchId').as('games'),
      eb.fn.coalesce(eb.fn.sum<number>('playerMatch.won'), eb.lit(0)).as('wins'),
      eb.fn.max('playerMatch.startTime').as('lastMatchAt'),
    ])
    .where((eb) => eb.or([eb('player.isFriend', '=', 1), eb('player.isSelf', '=', 1)]))
    .groupBy('player.accountId')
    .execute()
}

/** The CLI marks the logged-in Steam account with is_self = 1. */
export async function getSelfAccountId(): Promise<number | null> {
  const row = await getDb().selectFrom('player').select('accountId').where('isSelf', '=', 1).executeTakeFirst()
  return row?.accountId ?? null
}
