import { ipcMain } from 'electron'
import { z } from 'zod'
import { parsePlayerInput } from '@deadlock/core/domain/players/validators/player-input'
import { CHANNELS, type DesktopApi } from '../../shared/api'
import { getMatchDetail } from '../services/match-detail'
import { getFriends, getMates, searchPlayers } from '../services/player-lookup'
import { buildPlayerOverview } from '../services/player-overview'
import { buildPlayerAnalysis } from '../services/player-analysis'
import { getHeroCoaching } from '../services/hero-coaching'
import { getSelfAccountId, markViewed } from '../services/player-repo'
import { ensureCloudSession, getCloudSignInState, signOut } from '../cloud/auth'
import { CLOUD_URL, getCloudAccount } from '../cloud/client'
import { pendingPush } from '../cloud/sync'
import { getState } from '../sync/state'
import { disconnectSteam, importCliLogin } from '../steam/account'
import { cancelLogin, startPasswordLogin, startQrLogin, submitGuardCode } from '../steam/login'
import { backfillDetailsNow, fetchMatchNow, getSyncStatus, publishSyncStatus, runNow } from '../sync/scheduler'
import { upgradeMatchDetailFree } from '../sync/engine'
import { cloudDetailsSource } from '../cloud/sync'

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
    analysis: (accountId) => buildPlayerAnalysis(id.parse(accountId)),
    heroCoaching: (accountId) => getHeroCoaching(id.parse(accountId)),
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
    upgrade: (matchId) => upgradeMatchDetailFree(id.parse(matchId), cloudDetailsSource()).catch(() => false),
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
      const state = await ensureCloudSession()
      if (state?.kind === 'signed-in') runNow() // pull everything the group already has
    },
  },
  sync: {
    status: () => getSyncStatus(),
    run: async (options) => runNow({ accountId: options?.accountId ? id.parse(options.accountId) : undefined, full: options?.full === true }),
    details: async (accountId) => backfillDetailsNow(id.parse(accountId)),
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
