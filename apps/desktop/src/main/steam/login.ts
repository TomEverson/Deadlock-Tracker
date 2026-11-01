import QRCode from 'qrcode'
import { EAuthSessionGuardType, EAuthTokenPlatformType, LoginSession } from 'steam-session'
import type { SteamLoginEvent } from '../../shared/api'
import { broadcast } from '../broadcast'
import { ensureCloudSession } from '../cloud/auth'
import { saveRefreshToken, setSteamAccount } from './account'

// Signing the app's Steam client in. Uses Steam's own login flow (the same
// one the Steam client uses): QR code approved in the Steam mobile app, or
// account name + password + Steam Guard. Only the refresh token is kept.

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000
let session: LoginSession | null = null
let onConnected: (() => void) | null = null

/** Called once a login finishes and the cloud sign-in has been attempted. */
export function setOnConnected(fn: () => void): void {
  onConnected = fn
}
let lastGuard: { method: 'device-code' | 'email-code'; detail?: string } = { method: 'device-code' }

const emit = (e: SteamLoginEvent) => broadcast('steam:login', e)

function errorMessage(err: unknown): string {
  const e = err as { eresult?: number; message?: string }
  // EResult 5 = InvalidPassword, 84 = RateLimitExceeded, 65 = InvalidLoginAuthCode, 88 = TwoFactorCodeMismatch
  if (e?.eresult === 5) return 'Wrong account name or password.'
  if (e?.eresult === 84) return 'Too many login attempts. Wait a few minutes and try again.'
  return e?.message ?? String(err)
}

function wire(s: LoginSession): void {
  s.loginTimeout = LOGIN_TIMEOUT_MS
  s.on('remoteInteraction', () => emit({ kind: 'scanned' }))
  s.on('timeout', () => {
    if (session === s) emit({ kind: 'expired' })
  })
  s.on('error', (err) => {
    if (session === s) emit({ kind: 'error', message: errorMessage(err) })
  })
  s.on('authenticated', () => {
    if (session !== s) return
    const account = { accountId: s.steamID.accountid, name: s.accountName ?? null }
    void saveRefreshToken(s.refreshToken)
      .then(() => setSteamAccount(account))
      .then(() => emit({ kind: 'done', account }))
      // Same login signs the app in to the cloud, then the first sync runs.
      .then(() => ensureCloudSession(true))
      .then(() => onConnected?.())
    session = null
  })
}

export function cancelLogin(): void {
  session?.cancelLoginAttempt()
  session = null
}

export async function startQrLogin(): Promise<void> {
  cancelLogin()
  const s = new LoginSession(EAuthTokenPlatformType.SteamClient)
  session = s
  wire(s)
  try {
    const res = await s.startWithQR()
    if (!res.qrChallengeUrl) throw new Error('Steam did not return a QR code.')
    const image = await QRCode.toDataURL(res.qrChallengeUrl, { margin: 1, width: 232, color: { dark: '#000000', light: '#ffffff' } })
    emit({ kind: 'qr', image })
  } catch (err) {
    emit({ kind: 'error', message: errorMessage(err) })
  }
}

export async function startPasswordLogin(accountName: string, password: string): Promise<void> {
  cancelLogin()
  const s = new LoginSession(EAuthTokenPlatformType.SteamClient)
  session = s
  wire(s)
  try {
    const res = await s.startWithCredentials({ accountName, password })
    if (!res.actionRequired) return // 'authenticated' follows
    const types = (res.validActions ?? []).map((a) => a.type)
    const canConfirm = types.includes(EAuthSessionGuardType.DeviceConfirmation) || types.includes(EAuthSessionGuardType.EmailConfirmation)
    if (types.includes(EAuthSessionGuardType.DeviceCode)) {
      lastGuard = { method: 'device-code' }
      emit({ kind: 'guard', ...lastGuard, canConfirm })
    } else if (types.includes(EAuthSessionGuardType.EmailCode)) {
      lastGuard = { method: 'email-code', detail: res.validActions?.find((a) => a.type === EAuthSessionGuardType.EmailCode)?.detail }
      emit({ kind: 'guard', ...lastGuard, canConfirm })
    } else if (canConfirm) emit({ kind: 'confirm' })
    else emit({ kind: 'error', message: 'This account needs a Steam Guard method the app does not support.' })
  } catch (err) {
    emit({ kind: 'error', message: errorMessage(err) })
  }
}

export async function submitGuardCode(code: string): Promise<void> {
  if (!session) {
    emit({ kind: 'error', message: 'The login attempt expired. Start again.' })
    return
  }
  try {
    await session.submitSteamGuardCode(code.trim())
  } catch (err) {
    const e = err as { eresult?: number }
    if (e?.eresult === 65 || e?.eresult === 88) emit({ kind: 'guard', ...lastGuard, canConfirm: false, wrongCode: true })
    else emit({ kind: 'error', message: errorMessage(err) })
  }
}
