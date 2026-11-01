import { z } from 'zod'

const STEAM64_OFFSET = 76561197960265728n
const MAX_ACCOUNT_ID = 2 ** 32 - 1

export const accountIdSchema = z.coerce.number().int().positive().max(MAX_ACCOUNT_ID)

export type PlayerInput = { kind: 'account'; accountId: number } | { kind: 'name'; query: string }

function fromSteam64(raw: string): number | null {
  const id = BigInt(raw) - STEAM64_OFFSET
  if (id <= 0n || id > BigInt(MAX_ACCOUNT_ID)) return null
  return Number(id)
}

/**
 * Accepts everything people actually paste:
 *   76561199770982601                                  (SteamID64)
 *   1810716873                                         (SteamID3 / account id)
 *   [U:1:1810716873]
 *   https://steamcommunity.com/profiles/76561199770982601/
 *   https://steamcommunity.com/id/somevanity           (-> name search)
 *   any other text                                     (-> name search)
 */
export function parsePlayerInput(input: string): PlayerInput | null {
  const raw = input.trim()
  if (!raw) return null

  const profileUrl = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/i)
  if (profileUrl?.[1]) {
    const id = fromSteam64(profileUrl[1])
    return id ? { kind: 'account', accountId: id } : null
  }

  const vanityUrl = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/i)
  if (vanityUrl?.[1]) return { kind: 'name', query: decodeURIComponent(vanityUrl[1]) }

  const steam3 = raw.match(/^\[?U:1:(\d+)\]?$/i)
  if (steam3?.[1]) {
    const parsed = accountIdSchema.safeParse(steam3[1])
    return parsed.success ? { kind: 'account', accountId: parsed.data } : null
  }

  if (/^7656\d{13}$/.test(raw)) {
    const id = fromSteam64(raw)
    return id ? { kind: 'account', accountId: id } : null
  }

  if (/^\d{1,10}$/.test(raw)) {
    const parsed = accountIdSchema.safeParse(raw)
    if (parsed.success) return { kind: 'account', accountId: parsed.data }
  }

  return raw.length >= 2 ? { kind: 'name', query: raw.slice(0, 64) } : null
}

export const accountIdInput = z.object({ accountId: accountIdSchema })
