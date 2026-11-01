import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import type { Env } from '../env'
import { steamAuth } from './steam-plugin'

// One better-auth instance per request: the D1 binding and secrets come from
// the Worker env. The desktop app authenticates with `Authorization: Bearer
// <session token>` (bearer plugin).
export function createAuth(env: Env, request: Request) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: new URL(request.url).origin,
    basePath: '/api/auth',
    // Steam is the only way in; no email/password, no social providers.
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    telemetry: { enabled: false },
    plugins: [bearer(), steamAuth()],
  })
}

/** The signed-in user's Steam account id, or null. */
export async function getSessionAccount(env: Env, request: Request): Promise<{ userId: string; accountId: number } | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  if (!session) return null
  const row = await env.DB.prepare(`SELECT "accountId" AS id FROM "account" WHERE "userId" = ? AND "providerId" = 'steam'`)
    .bind(session.user.id)
    .first<{ id: string }>()
  if (!row) return null
  return { userId: session.user.id, accountId: Number(BigInt(row.id) - 76561197960265728n) }
}
