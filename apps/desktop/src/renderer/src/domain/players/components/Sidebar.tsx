import { Link } from '@tanstack/react-router'
import { Avatar, TimeAgo } from '~/components/ui'
import type { FriendList } from '@deadlock/core/domain/players/types'
import { SyncWidget } from '~/domain/sync/components/SyncWidget'
import { SearchForm } from './SearchForm'

const itemClass = 'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink'
const activeClass = 'bg-surface-2 !text-ink'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 px-2 text-sm font-semibold text-ink">
      <img src="./favicon.svg" alt="" width={18} height={18} />
      Deadlock Tracker
    </Link>
  )
}

/** App navigation: search, you, and your Steam friends (as of the last sync). */
export function Sidebar({ friendList }: { friendList: FriendList }) {
  const { friends } = friendList
  return (
    <nav className="flex h-full flex-col gap-4 px-3 py-4" aria-label="Main">
      <Logo />

      <div className="grid gap-0.5">
        <Link to="/" className={itemClass} activeProps={{ className: activeClass }} activeOptions={{ exact: true, includeSearch: false }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
            <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5V7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Home
        </Link>
        <Link to="/analysis" className={itemClass} activeProps={{ className: activeClass }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
            <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Analysis
        </Link>
        <Link to="/matches" className={itemClass} activeProps={{ className: activeClass }} activeOptions={{ exact: true }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
            <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Matches
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="label mb-1 px-2">Friends</div>
        {friends.length === 0 ? (
          <p className="px-2 text-xs text-muted">
            Your Steam friends appear here after the first sync.
          </p>
        ) : (
          <ul className="-mx-1 grid min-h-0 gap-0.5 overflow-y-auto px-1">
            {friends.map((f) => (
              <li key={f.accountId}>
                <Link to="/players/$accountId" params={{ accountId: f.accountId }} className={itemClass} activeProps={{ className: activeClass }}>
                  <Avatar src={f.avatar} name={f.name} size={16} />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <TimeAgo at={f.lastMatchAt == null ? null : f.lastMatchAt * 1000} className="shrink-0 text-xs text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line pt-3">
        <SyncWidget />
      </div>
    </nav>
  )
}

/** Mobile: compact top bar instead of the sidebar. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-sidebar/95 px-4 backdrop-blur md:hidden">
      <Logo />
      <div className="ml-auto w-full max-w-[14rem]">
        <SearchForm />
      </div>
    </header>
  )
}
