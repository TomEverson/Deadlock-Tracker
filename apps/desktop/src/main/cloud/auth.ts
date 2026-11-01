import type { MeResult } from '@deadlock/core/sync/protocol'
import { BrowserWindow, session } from 'electron'
import { getRefreshToken } from '../steam/account'
import { steamWebCookies } from '../steam/web-session'
import { getState, setState } from '../sync/state'
import { CLOUD_URL, clearCloudSession, cloudFetch, getCloudToken, saveCloudSession } from './client'

// Cloud sign-in reuses the app's one Steam login: the Steam session's web
// cookies go into a throwaway window that opens Steam's "Sign in through
// Steam" page for the cloud and confirms it automatically. Steam still
// verifies the sign-in for the Worker (OpenID), and the cookies never leave
// steamcommunity.com. The Worker redirects to deadlock-tracker://auth with a
// session token, which we catch before it navigates anywhere.

const RETURN = 'deadlock-tracker://auth'
const STEAM = 'https://steamcommunity.com'
const AUTO_TIMEOUT_MS = 30_000
// Don't keep retrying an account the admin hasn't allowed yet.
const NOT_ALLOWED_RETRY_MS = 30 * 60 * 1000

export type CloudSignInState =
  | { kind: 'signed-in' }
  | { kind: 'not-allowed'; accountId: number; at: string }
  | { kind: 'error'; message: string; at: string }

const STATE_KEY = 'cloud.signIn'

const MESSAGES: Record<string, string> = {
  steam_rejected: "Steam couldn't confirm the sign-in.",
  server_error: 'The cloud had a problem signing you in.',
  timeout: "Steam's sign-in page didn't respond.",
}

/** Steam's OpenID page for a signed-in user has a form with a "Sign In" button. */
const CONFIRM_SCRIPT = `(() => {
  const form = document.getElementById('openidForm')
  if (form) { form.submit(); return true }
  const button = document.querySelector('#imageLogin, form input[type=submit], form button[type=submit]')
  if (button) { button.click(); return true }
  return false
})()`

async function openIdSignIn(refreshToken: string): Promise<{ token: string } | { error: string; account?: string }> {
  const partition = `steam-signin-${Date.now()}`
  const ses = session.fromPartition(partition)
  for (const c of await steamWebCookies(refreshToken)) {
    await ses.cookies.set({ url: STEAM, name: c.name, value: c.value, secure: true, httpOnly: c.name !== 'sessionid', sameSite: 'no_restriction' })
  }
  const win = new BrowserWindow({ show: false, width: 520, height: 760, webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'timeout' }), AUTO_TIMEOUT_MS)
      const finish = (r: { token: string } | { error: string; account?: string }) => {
        clearTimeout(timer)
        resolve(r)
      }
      const catchReturn = (event: Electron.Event, url: string) => {
        if (!url.startsWith(RETURN)) return
        event.preventDefault()
        const params = new URL(url).searchParams
        const token = params.get('token')
        finish(token ? { token } : { error: params.get('error') ?? 'server_error', account: params.get('account') ?? undefined })
      }
      win.webContents.on('will-redirect', catchReturn)
      win.webContents.on('will-navigate', catchReturn)
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().startsWith(`${STEAM}/openid/login`)) {
          void win.webContents.executeJavaScript(CONFIRM_SCRIPT).then((clicked: boolean) => {
            if (!clicked) finish({ error: 'steam_rejected' })
          })
        }
      })
      void win.loadURL(`${CLOUD_URL}/api/auth/steam/start?redirect=${encodeURIComponent(RETURN)}`)
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
    void ses.clearStorageData()
  }
}

/**
 * Make sure the cloud session exists, using the connected Steam account.
 * Quiet: never opens anything visible. `force` retries even right after a
 * "not allowed" answer (e.g. the user pressed Retry).
 */
export async function ensureCloudSession(force = false): Promise<CloudSignInState | null> {
  if (await getCloudToken()) return { kind: 'signed-in' }
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return null
  const last = await getState<CloudSignInState>(STATE_KEY)
  if (!force && last?.kind === 'not-allowed' && Date.now() - Date.parse(last.at) < NOT_ALLOWED_RETRY_MS) return last

  const at = new Date().toISOString()
  let state: CloudSignInState
  try {
    const result = await openIdSignIn(refreshToken)
    if ('token' in result) {
      const me = await cloudFetch<MeResult>('/v1/me', { token: result.token })
      await saveCloudSession(result.token, me)
      state = { kind: 'signed-in' }
    } else if (result.error === 'not_allowed') {
      state = { kind: 'not-allowed', accountId: Number(result.account ?? 0), at }
    } else {
      state = { kind: 'error', message: MESSAGES[result.error] ?? 'Cloud sign-in failed.', at }
    }
  } catch (err) {
    state = { kind: 'error', message: err instanceof Error ? err.message : String(err), at }
  }
  await setState(STATE_KEY, state)
  return state
}

export const getCloudSignInState = () => getState<CloudSignInState>(STATE_KEY)

export async function signOut(): Promise<void> {
  const token = await getCloudToken()
  if (token) {
    await fetch(`${CLOUD_URL}/api/auth/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: CLOUD_URL } }).catch(() => null)
  }
  await clearCloudSession()
}
