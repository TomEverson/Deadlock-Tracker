import { zValidator } from '@hono/zod-validator'
import { detailsGetBody, detailsLookupBody, pushBody, type MeResult } from '@deadlock/core/sync/protocol'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDetails, handlePull, lookupDetails } from '../sync/pull'
import { handlePush } from '../sync/push'
import type { AppEnv } from '../types'
import { validationHook } from './validation'

/** /v1 — what every signed-in install uses. */
export const syncRoutes = new Hono<AppEnv>()
  .get('/me', async (c) => {
    const accountId = c.get('accountId')
    const name = await c.env.DB.prepare('SELECT persona_name FROM player WHERE account_id = ?').bind(accountId).first<string>('persona_name')
    return c.json({ accountId, name: name ?? `Steam ${accountId}` } satisfies MeResult)
  })
  .post('/push', zValidator('json', pushBody, validationHook), async (c) => c.json(await handlePush(c.env, c.req.valid('json'), c.get('accountId'))))
  .get('/pull', zValidator('query', z.object({ since: z.coerce.number().int().nonnegative().default(0) }), validationHook), async (c) =>
    c.json(await handlePull(c.env, c.req.valid('query').since)),
  )
  .post('/details/lookup', zValidator('json', detailsLookupBody, validationHook), async (c) => {
    const { matchIds, minVersion } = c.req.valid('json')
    return c.json({ have: await lookupDetails(c.env, matchIds, minVersion) })
  })
  .post('/details/get', zValidator('json', detailsGetBody, validationHook), async (c) => c.json({ details: await getDetails(c.env, c.req.valid('json').matchIds) }))
