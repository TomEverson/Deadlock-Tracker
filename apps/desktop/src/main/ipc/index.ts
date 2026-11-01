import { ipcMain } from 'electron'
import type { AllowlistEntry } from '@deadlock/core/sync/protocol'
import { z } from 'zod'
import { parsePlayerInput } from '@deadlock/core/domain/players/validators/player-input'
import { CHANNELS, type DesktopApi } from '../../shared/api'
import { findLegacyDatabase, importLegacyDatabase } from '../legacy-import'
import { getMatchDetail } from '../services/match-detail'
import { getFriends, getMates, searchPlayers } from '../services/player-lookup'
import { buildPlayerOverview } from '../services/player-overview'
import { getSelfAccountId, markViewed } from '../services/player-repo'
import { db } from '../db'
import { ensureCloudSession, getCloudSignInState, signOut } from '../cloud/auth'
import { CLOUD_URL, cloudFetch, getCloudAccount } from '../cloud/client'
import { pendingPush } from '../cloud/sync'
import { getState } from '../sync/state'
import { disconnectSteam, importCliLogin } from '../steam/account'
import { cancelLogin, startPasswordLogin, startQrLogin, submitGuardCode } from '../steam/login'
import { fetchMatchNow, getSyncStatus, publishSyncStatus, runNow } from '../sync/scheduler'

const id = z.number().int().positive()

type Handlers = Omit<DesktopApi, 'platform' | 'on'>

const handlers: Handlers = {
  players: {
    async overview(accountId) {
      const parsed = id.parse(accountId)
      await markViewed(parsed)
      return buildPlayerOverview(parsed)
    },
    async mates(accountId) {
      try {
        return { kind: 'ok', mates: await getMates(id.parse(accountId)) }
      } catch {
        return { kind: 'unavailable', mates: [] }
      }
    },
    friends: () => getFriends(),
    async search(q) {
      const parsed = parsePlayerInput(z.string().max(200).parse(q))
      if (!parsed) return { kind: 'invalid' }
      if (parsed.kind === 'account') return { kind: 'account', accountId: parsed.accountId }
      try {
        return { kind: 'results', query: parsed.query, results: await searchPlayers(parsed.query) }
      } catch (err) {
        return { kind: 'error', message: err instanceof Error ? err.message : 'Search failed' }
      }
    },
    selfAccountId: () => getSelfAccountId(),
  },
  matches: {
    detail: (matchId) => getMatchDetail(id.parse(matchId)),
  },
  data: {
    async legacyStatus() {
      const row = await db().selectFrom('playerMatch').select('matchId').limit(1).executeTakeFirst()
      return { found: findLegacyDatabase(), hasData: row !== undefined }
    },
    async importLegacy() {
      const file = findLegacyDatabase()
      if (!file) throw new Error('No old database found')
      return importLegacyDatabase(file)
    },
  },
  steam: {
    loginQr: () => startQrLogin(),
    loginPassword: (accountName, password) => startPasswordLogin(z.string().min(1).max(64).parse(accountName), z.string().min(1).max(256).parse(password)),
    submitCode: (code) => submitGuardCode(z.string().min(1).max(16).parse(code)),
    cancelLogin: async () => cancelLogin(),
    async disconnect() {
      // One login: disconnecting Steam also signs out of the cloud.
      await disconnectSteam()
      await signOut()
      await publishSyncStatus()
    },
    async importCliLogin() {
      const account = await importCliLogin()
      await publishSyncStatus()
      return account
    },
  },
  cloud: {
    async status() {
      const account = await getCloudAccount()
      const attempt = await getCloudSignInState()
      return {
        url: CLOUD_URL,
        account,
        signIn: !account && attempt && attempt.kind !== 'signed-in' ? attempt : null,
        lastSync: await getState<{ at: string; error: string | null }>('cloud.lastSync'),
        pending: await pendingPush(),
      }
    },
    async signIn() {
      const state = await ensureCloudSession(true)
      if (state?.kind === 'signed-in') runNow() // pull everything the group already has
    },
    async allowlist() {
      return (await cloudFetch<{ entries: AllowlistEntry[] }>('/v1/admin/allowlist')).entries
    },
    async allow(who, role) {
      const parsed = parsePlayerInput(z.string().max(200).parse(who))
      if (parsed?.kind !== 'account') return { ok: false, message: 'Enter an account ID, SteamID64 or Steam profile URL.' }
      try {
        await cloudFetch('/v1/admin/allowlist', { body: { accountId: parsed.accountId, role: role === 'admin' ? 'admin' : 'member' } })
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    async revoke(accountId) {
      try {
        await cloudFetch(`/v1/admin/allowlist/${id.parse(accountId)}`, { method: 'DELETE' })
        return { ok: true }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
  },
  sync: {
    status: () => getSyncStatus(),
    run: async (options) => runNow({ accountId: options?.accountId ? id.parse(options.accountId) : undefined, full: options?.full === true }),
    match: (matchId) => fetchMatchNow(id.parse(matchId)),
  },
}

/** One ipcMain.handle per contract method: "players:overview", … */
export function registerIpc(): void {
  for (const [ns, methods] of Object.entries(CHANNELS)) {
    const group = handlers[ns as keyof Handlers] as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const method of methods) {
      ipcMain.handle(`${ns}:${method}`, (_event, ...args: unknown[]) => group[method]!(...args))
    }
  }
}
