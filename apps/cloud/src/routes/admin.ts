import { zValidator } from '@hono/zod-validator'
import { allowlistBody } from '@deadlock/core/sync/protocol'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireAdmin } from '../middleware'
import { addToAllowlist, listAllowlist, removeFromAllowlist } from '../sync/allowlist'
import type { AppEnv } from '../types'
import { validationHook } from './validation'

/** /v1/admin — managing who can sign in. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get('/allowlist', async (c) => c.json({ entries: await listAllowlist(c.env) }))
  .post('/allowlist', zValidator('json', allowlistBody, validationHook), async (c) => {
    await addToAllowlist(c.env, c.req.valid('json'), c.get('accountId'))
    return c.json({ ok: true })
  })
  .delete('/allowlist/:accountId', zValidator('param', z.object({ accountId: z.coerce.number().int().positive() }), validationHook), async (c) => {
    const { accountId } = c.req.valid('param')
    if (accountId === c.get('accountId')) throw new HTTPException(400, { message: "You can't remove yourself" })
    await removeFromAllowlist(c.env, accountId)
    return c.json({ ok: true })
  })
