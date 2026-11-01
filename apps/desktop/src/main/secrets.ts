import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Tokens (Steam refresh token, cloud session) encrypted with the OS keychain
// via Electron safeStorage, stored as files in userData/secrets. Passwords are
// never stored.

export type SecretName = 'steam-refresh-token' | 'cloud-session'

const dir = () => join(app.getPath('userData'), 'secrets')
const file = (name: SecretName) => join(dir(), `${name}.bin`)
const cache = new Map<SecretName, string | null>()

export async function saveSecret(name: SecretName, value: string): Promise<void> {
  mkdirSync(dir(), { recursive: true, mode: 0o700 })
  // Without a keychain (some Linux setups) fall back to a file only this user can read.
  const data = (await safeStorage.isAsyncEncryptionAvailable()) ? await safeStorage.encryptStringAsync(value) : Buffer.from(`plain:${value}`)
  await writeFile(file(name), data, { mode: 0o600 })
  cache.set(name, value)
}

export async function readSecret(name: SecretName): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null
  let value: string | null = null
  if (existsSync(file(name))) {
    const data = await readFile(file(name))
    const asText = data.toString('utf8')
    if (asText.startsWith('plain:')) value = asText.slice(6)
    else {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data)
        value = result
        if (shouldReEncrypt) await saveSecret(name, result)
      } catch {
        value = null
      }
    }
  }
  cache.set(name, value)
  return value
}

export function deleteSecret(name: SecretName): void {
  rmSync(file(name), { force: true })
  cache.set(name, null)
}
