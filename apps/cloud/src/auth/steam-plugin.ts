import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { z } from 'zod'
import type { Env } from '../env'
import { isAllowed } from '../sync/allowlist'
import { steamLoginUrl, toSteamId64, verifySteamAssertion } from './steam-openid'

// better-auth plugin: "Sign in through Steam" for the desktop app.
//
//   GET /api/auth/steam/start?redirect=deadlock-tracker://auth
//     → Steam's login page
//   GET /api/auth/steam/callback?state=…  (Steam redirects here)
//     → verifies the assertion with Steam, checks the allowlist, creates a
//       session → 302 deadlock-tracker://auth?token=…
//
// The app opens /start in its own window and catches the final redirect.

const APP_SCHEME = 'deadlock-tracker://'
const STATE_PREFIX = 'steam-state:'
const STATE_TTL_MS = 10 * 60 * 1000
const PROVIDER = 'steam'

function withParams(target: string, params: Record<string, string>): string {
  return `${target}${target.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`
}

export function steamAuth(env: Env): BetterAuthPlugin {
  return {
    id: 'steam',
    endpoints: {
      steamStart: createAuthEndpoint(
        '/steam/start',
        { method: 'GET', query: z.object({ redirect: z.string().startsWith(APP_SCHEME).max(200) }) },
        async (ctx) => {
          const state = crypto.randomUUID().replaceAll('-', '')
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${STATE_PREFIX}${state}`,
            value: ctx.query.redirect,
            expiresAt: new Date(Date.now() + STATE_TTL_MS),
          })
          const base = ctx.context.baseURL // …/api/auth
          const origin = new URL(base).origin
          throw ctx.redirect(steamLoginUrl(`${base}/steam/callback?state=${state}`, origin))
        },
      ),
      steamCallback: createAuthEndpoint(
        '/steam/callback',
        { method: 'GET', query: z.object({ state: z.string().regex(/^[a-f0-9]{32}$/) }).passthrough(), requireRequest: true },
        async (ctx) => {
          const pending = await ctx.context.internalAdapter.consumeVerificationValue(`${STATE_PREFIX}${ctx.query.state}`)
          if (!pending || pending.expiresAt.getTime() < Date.now()) {
            return new Response('This sign-in link expired. Start again from the app.', { status: 400 })
          }
          const target = pending.value
          const fail = (error: string, extra: Record<string, string> = {}) => {
            throw ctx.redirect(withParams(target, { error, ...extra }))
          }

          const returnTo = `${ctx.context.baseURL}/steam/callback?state=${ctx.query.state}`
          const accountId = await verifySteamAssertion(new URL(ctx.request!.url), returnTo).catch(() => null)
          if (!accountId) return fail('steam_rejected')
          if (!(await isAllowed(env, accountId))) return fail('not_allowed', { account: String(accountId) })

          const steamId64 = toSteamId64(accountId)
          const existing = await ctx.context.adapter.findOne<{ userId: string }>({
            model: 'account',
            where: [
              { field: 'providerId', operator: 'eq', value: PROVIDER },
              { field: 'accountId', operator: 'eq', value: steamId64 },
            ],
          })
          let userId = existing?.userId
          if (!userId) {
            const user = await ctx.context.internalAdapter.createUser(
              { name: `Steam ${accountId}`, email: `${steamId64}@steam.invalid`, image: null },
              { method: PROVIDER },
            )
            await ctx.context.internalAdapter.createAccount({ userId: user.id, providerId: PROVIDER, accountId: steamId64 })
            userId = user.id
          }
          const session = await ctx.context.internalAdapter.createSession(userId)
          if (!session) return fail('server_error')
          throw ctx.redirect(withParams(target, { token: session.token, account: String(accountId) }))
        },
      ),
    },
  }
}
