import type { AllowlistEntry } from '@deadlock/core/sync/protocol'
import type { Env } from '../env'

/** Allowed to sign in? The configured admin is added automatically the first time. */
export async function isAllowed(env: Env, accountId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM allowlist WHERE account_id = ?').bind(accountId).first()
  if (row) return true
  if (String(accountId) === env.ADMIN_ACCOUNT_ID) {
    await env.DB.prepare("INSERT OR IGNORE INTO allowlist (account_id, role, note, added_at) VALUES (?, 'admin', 'owner', ?)")
      .bind(accountId, new Date().toISOString())
      .run()
    return true
  }
  return false
}

export async function roleOf(env: Env, accountId: number): Promise<'admin' | 'member' | null> {
  const row = await env.DB.prepare('SELECT role FROM allowlist WHERE account_id = ?').bind(accountId).first<{ role: string }>()
  return row ? (row.role === 'admin' ? 'admin' : 'member') : null
}

export async function listAllowlist(env: Env): Promise<AllowlistEntry[]> {
  const { results } = await env.DB.prepare('SELECT account_id, role, note, added_at FROM allowlist ORDER BY added_at').all<{
    account_id: number
    role: string
    note: string | null
    added_at: string
  }>()
  return results.map((r) => ({ accountId: r.account_id, role: r.role === 'admin' ? 'admin' : 'member', note: r.note, addedAt: r.added_at }))
}

export async function addToAllowlist(env: Env, entry: { accountId: number; role: 'admin' | 'member'; note?: string }, by: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO allowlist (account_id, role, note, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET role = excluded.role, note = excluded.note',
  )
    .bind(entry.accountId, entry.role, entry.note ?? null, by, new Date().toISOString())
    .run()
}

/** Removes access and signs that account out everywhere. */
export async function removeFromAllowlist(env: Env, accountId: number): Promise<void> {
  const steamId64 = (76561197960265728n + BigInt(accountId)).toString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM allowlist WHERE account_id = ?').bind(accountId),
    env.DB.prepare(`DELETE FROM "session" WHERE "userId" IN (SELECT "userId" FROM "account" WHERE "providerId" = 'steam' AND "accountId" = ?)`).bind(steamId64),
  ])
}
