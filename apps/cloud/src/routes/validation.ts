import type { Hook } from '@hono/zod-validator'
import type { Env } from 'hono'

/** Invalid input → 400 with the same `{ error }` shape as every other failure. */
export const validationHook: Hook<unknown, Env, string> = (result, c) => {
  if (!result.success) return c.json({ error: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 500) }, 400)
}
