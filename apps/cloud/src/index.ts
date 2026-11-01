import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createAuth } from './auth'
import { requireMember } from './middleware'
import { adminRoutes } from './routes/admin'
import { syncRoutes } from './routes/sync'
import type { AppEnv } from './types'

// Deadlock Tracker cloud: Sign in with Steam (/api/auth/*, better-auth) and
// the sync API (/v1/*) for the desktop app. No website.

const v1 = new Hono<AppEnv>()
  .use(async (c, next) => {
    await next()
    c.header('cache-control', 'no-store')
  })
  .use(requireMember)
  .route('/', syncRoutes)
  .route('/admin', adminRoutes)

const app = new Hono<AppEnv>()
  .get('/', (c) => c.json({ ok: true, service: 'deadlock-cloud' }))
  .get('/health', (c) => c.json({ ok: true, service: 'deadlock-cloud' }))
  .on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env, c.req.raw).handler(c.req.raw))
  .route('/v1', v1)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal error' }, 500)
})

export type AppType = typeof app
export default app
