// Steam OpenID 2.0 ("Sign in through Steam"). Steam has no OAuth; the
// relying party redirects to Steam, Steam redirects back with a signed
// assertion, and we confirm it by asking Steam (check_authentication).

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const NS = 'http://specs.openid.net/auth/2.0'
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select'
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/
const STEAM_ID64_BASE = 76561197960265728n

export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  })
  return `${OPENID_ENDPOINT}?${params}`
}

/** The SteamID3 (account id) Steam vouches for, or null if the assertion is not valid. */
export async function verifySteamAssertion(callbackUrl: URL, expectedReturnTo: string): Promise<number | null> {
  const p = callbackUrl.searchParams
  if (p.get('openid.mode') !== 'id_res') return null
  if (p.get('openid.op_endpoint') !== OPENID_ENDPOINT) return null
  if (p.get('openid.return_to') !== expectedReturnTo) return null
  const claimed = p.get('openid.claimed_id') ?? ''
  const match = CLAIMED_ID.exec(claimed)
  if (!match || p.get('openid.identity') !== claimed) return null

  const body = new URLSearchParams()
  for (const [k, v] of p) if (k.startsWith('openid.')) body.set(k, v)
  body.set('openid.mode', 'check_authentication')
  const res = await fetch(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  if (!res.ok || !/^is_valid\s*:\s*true\s*$/m.test(text)) return null
  return Number(BigInt(match[1]!) - STEAM_ID64_BASE)
}

export const toSteamId64 = (accountId: number) => (STEAM_ID64_BASE + BigInt(accountId)).toString()
