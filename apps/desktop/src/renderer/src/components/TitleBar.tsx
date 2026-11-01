import { useCanGoBack, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { SearchForm } from '~/domain/players/components/SearchForm'

const isMac = window.api.platform === 'darwin'

/**
 * The router only knows whether it can go back; count forward steps from
 * history actions (BACK adds one, FORWARD uses one, a new page clears them).
 */
function useCanGoForward(): boolean {
  const router = useRouter()
  const [forward, setForward] = useState(0)
  useEffect(
    () =>
      router.history.subscribe(({ action }) => {
        if (action.type === 'BACK') setForward((n) => n + 1)
        else if (action.type === 'FORWARD') setForward((n) => Math.max(0, n - 1))
        else if (action.type === 'PUSH') setForward(0)
      }),
    [router],
  )
  return forward > 0
}

function NavButton({ label, shortcut, disabled, onClick, children }: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${shortcut})`}
      aria-label={label}
      className="app-no-drag grid h-7 w-7 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}

/**
 * Desktop title bar. On macOS the window's own title bar is hidden
 * (titleBarStyle: hiddenInset), so this bar sits beside the traffic lights:
 * it drags the window and double-click zooms it, like a native one.
 * Buttons and the search field opt out of dragging (app-no-drag).
 */
export function TitleBar() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const canGoForward = useCanGoForward()
  const back = () => router.history.back()
  const forward = () => router.history.forward()

  // ⌘[ / ⌘] (Ctrl elsewhere), like Finder and browsers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === '[') {
        e.preventDefault()
        router.history.back()
      } else if (e.key === ']') {
        e.preventDefault()
        router.history.forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  const mod = isMac ? '⌘' : 'Ctrl+'
  return (
    <header className="app-drag col-span-2 hidden h-10 items-center border-b border-line bg-sidebar md:grid md:grid-cols-[232px_1fr]">
      {/* Left: room for the traffic lights, then history buttons (aligned with the sidebar). */}
      <div className={`flex h-full items-center gap-0.5 border-r border-line pr-3 ${isMac ? 'pl-[78px]' : 'pl-3'}`}>
        <NavButton label="Back" shortcut={`${mod}[`} disabled={!canGoBack} onClick={back}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </NavButton>
        <NavButton label="Forward" shortcut={`${mod}]`} disabled={!canGoForward} onClick={forward}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </NavButton>
      </div>
      {/* Right: player search. */}
      <div className="flex h-full items-center justify-end px-4">
        <div className="app-no-drag w-full max-w-xs">
          <SearchForm />
        </div>
      </div>
    </header>
  )
}
