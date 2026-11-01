import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getSessionAccount } from './auth'
import { roleOf } from './sync/allowlist'
import type { AppEnv } from './types'

/** Signed in with Steam and still on the allowlist (removal takes effect immediately). */
export const requireMember = createMiddleware<AppEnv>(async (c, next) => {
  const me = await getSessionAccount(c.env, c.req.raw)
  if (!me) throw new HTTPException(401, { message: 'Sign in with Steam first' })
  const role = await roleOf(c.env, me.accountId)
  if (!role) throw new HTTPException(403, { message: 'This Steam account is not on the allowlist' })
  c.set('accountId', me.accountId)
  c.set('role', role)
  await next()
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('role') !== 'admin') throw new HTTPException(403, { message: 'Admins only' })
  await next()
})
