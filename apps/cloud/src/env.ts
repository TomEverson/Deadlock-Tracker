export interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  /** SteamID3 that becomes admin on first sign-in. */
  ADMIN_ACCOUNT_ID: string
}
