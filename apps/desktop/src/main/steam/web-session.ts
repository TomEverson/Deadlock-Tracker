import SteamUser from 'steam-user'

export interface WebCookie {
  name: string
  value: string
}

const TIMEOUT_MS = 30_000
// Fixed and different from the sync's logon ID, so this short session never
// kicks the user's Steam client or a running sync.
const LOGON_ID = 0x444c4b57

/**
 * steamcommunity.com cookies for the account behind a refresh token. Since
 * 2025 Steam only issues these over an authenticated client (CM) session, so
 * this logs on briefly with steam-user and asks for a web session. The
 * cookies are only ever handed to Electron's cookie store for
 * steamcommunity.com, never sent anywhere else.
 */
export async function steamWebCookies(refreshToken: string): Promise<WebCookie[]> {
  const client = new SteamUser({ autoRelogin: false, renewRefreshTokens: false })
  try {
    const cookies = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Steam did not answer in time.')), TIMEOUT_MS)
      client.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      client.once('loggedOn', () => client.webLogOn())
      client.once('webSession', (_sessionId, webCookies) => {
        clearTimeout(timer)
        resolve(webCookies)
      })
      client.logOn({ refreshToken, logonID: LOGON_ID })
    })
    return cookies.flatMap((c) => {
      const [pair] = c.split(';')
      const eq = pair?.indexOf('=') ?? -1
      return pair && eq > 0 ? [{ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }] : []
    })
  } finally {
    client.logOff()
  }
}
