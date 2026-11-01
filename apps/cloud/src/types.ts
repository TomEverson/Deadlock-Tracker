import type { Env } from './env'

/** Hono environment: Worker bindings + what the auth middleware sets. */
export interface AppEnv {
  Bindings: Env
  Variables: {
    /** Signed-in user's Steam account id (SteamID3). */
    accountId: number
    role: 'admin' | 'member'
  }
}
