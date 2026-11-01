import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SteamAccount } from '../../shared/api'
import { deleteSecret, readSecret, saveSecret } from '../secrets'
import { deleteState, getState, setState } from '../sync/state'

const STEAM_ID64_BASE = 76561197960265728n
const CLI_TOKEN_FILE = join(homedir(), '.deadlock-tracker', 'steam-refresh-token')

export const getRefreshToken = () => readSecret('steam-refresh-token')
export const saveRefreshToken = (token: string) => saveSecret('steam-refresh-token', token)

export async function getSteamAccount(): Promise<SteamAccount | null> {
  const token = await getRefreshToken()
  if (!token) return null
  return (await getState<SteamAccount>('steam.account')) ?? { accountId: accountIdFromToken(token), name: null }
}

export async function setSteamAccount(account: SteamAccount): Promise<void> {
  await setState('steam.account', account)
}

export async function disconnectSteam(): Promise<void> {
  deleteSecret('steam-refresh-token')
  await deleteState('steam.account')
}

/** Steam refresh tokens are JWTs whose `sub` is the SteamID64. */
export function accountIdFromToken(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string }
    return payload.sub ? Number(BigInt(payload.sub) - STEAM_ID64_BASE) : 0
  } catch {
    return 0
  }
}

/** The Steam token the old command-line tool saved, if any. */
export function hasCliLogin(): boolean {
  return existsSync(CLI_TOKEN_FILE)
}

export async function importCliLogin(): Promise<SteamAccount> {
  const token = readFileSync(CLI_TOKEN_FILE, 'utf8').trim()
  const accountId = accountIdFromToken(token)
  if (!accountId) throw new Error("The old login file doesn't contain a valid Steam token.")
  await saveRefreshToken(token)
  const account = { accountId, name: null }
  await setSteamAccount(account)
  return account
}
