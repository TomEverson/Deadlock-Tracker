import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getSessionAccount } from './auth'
import type { AppEnv } from './types'

/** Any signed-in Steam account may read and write the shared data. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const me = await getSessionAccount(c.env, c.req.raw)
  if (!me) throw new HTTPException(401, { message: 'Sign in with Steam first' })
  c.set('accountId', me.accountId)
  await next()
})
