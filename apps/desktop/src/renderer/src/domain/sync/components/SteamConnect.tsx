import { useEffect, useState } from 'react'
import { Segmented } from '~/components/ui'
import type { SteamLoginEvent } from '../../../../../shared/api'

type Method = 'qr' | 'password'

const inputClass = 'h-8 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted focus:border-line-strong focus:outline-none'
const primary = 'h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60'

/** Sign the app's Steam client in: QR code (Steam mobile app) or password + Steam Guard. */
export function SteamConnect() {
  const [method, setMethod] = useState<Method>('qr')
  const [event, setEvent] = useState<SteamLoginEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => window.api.on('steam:login', (e) => {
    setEvent(e)
    setBusy(false)
    if (e.kind === 'guard') setCode('')
  }), [])

  useEffect(() => {
    if (method === 'qr') void window.api.steam.loginQr()
    return () => void window.api.steam.cancelLogin()
  }, [method])

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">
        One Steam login does everything: the app reads your match history from Deadlock's servers (like the game does) and signs you in to the cloud you share with
        your friends. Your password goes straight to Steam and is never stored — only Steam's login token, encrypted with your system keychain.
      </p>
      <Segmented<Method>
        value={method}
        onChange={(m) => {
          setEvent(null)
          setMethod(m)
        }}
        options={[
          { value: 'qr', label: 'QR code' },
          { value: 'password', label: 'Password' },
        ]}
      />

      {method === 'qr' && (
        <div className="flex flex-wrap items-center gap-5">
          <div className="grid h-[180px] w-[180px] place-items-center overflow-hidden rounded-lg border border-line bg-white">
            {event?.kind === 'qr' || event?.kind === 'scanned' ? (
              <img src={event.kind === 'qr' ? event.image : undefined} alt="Steam login QR code" width={180} height={180} className={event.kind === 'scanned' ? 'opacity-20' : ''} />
            ) : (
              <span className="text-xs text-neutral-500">{event?.kind === 'expired' || event?.kind === 'error' ? 'Expired' : 'Loading…'}</span>
            )}
          </div>
          <div className="grid max-w-xs gap-2 text-sm">
            {event?.kind === 'scanned' ? (
              <p className="text-ink">Scanned — approve the login in the Steam app.</p>
            ) : (
              <p className="text-ink-2">Open the Steam mobile app → Steam Guard → scan this QR code, then approve.</p>
            )}
            {(event?.kind === 'expired' || event?.kind === 'error') && (
              <>
                {event.kind === 'error' && <p className="text-xs text-loss">{event.message}</p>}
                <button type="button" className={primary} onClick={() => void window.api.steam.loginQr()}>
                  New QR code
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {method === 'password' && (
        <div className="grid max-w-sm gap-3">
          {event?.kind === 'guard' ? (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setBusy(true)
                void window.api.steam.submitCode(code)
              }}
            >
              <label className="text-sm text-ink-2">
                {event.method === 'email-code' ? `Steam Guard code from the email sent to ${event.detail ?? 'you'}` : 'Steam Guard code from the Steam mobile app'}
              </label>
              <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus className={`${inputClass} num tracking-widest uppercase`} maxLength={8} />
              {event.wrongCode && <p className="text-xs text-loss">That code was wrong — try again.</p>}
              {event.canConfirm && <p className="text-xs text-muted">Or approve the login in the Steam app.</p>}
              <button type="submit" disabled={busy || code.trim().length < 5} className={primary}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          ) : event?.kind === 'confirm' ? (
            <p className="text-sm text-ink">Approve the login in the Steam mobile app (or the email Steam sent you).</p>
          ) : (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setBusy(true)
                setEvent(null)
                void window.api.steam.loginPassword(name.trim(), password).finally(() => setPassword(''))
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Steam account name" autoComplete="username" className={inputClass} />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" className={inputClass} />
              {event?.kind === 'error' && <p className="text-xs text-loss">{event.message}</p>}
              <button type="submit" disabled={busy || !name.trim() || !password} className={primary}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      )}

    </div>
  )
}
