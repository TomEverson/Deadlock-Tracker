import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-muted">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Player search: Steam ID, SteamID64, profile URL or name. Enter to search. */
export function SearchForm({ initial = '', large = false }: { initial?: string; large?: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initial)
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const value = q.trim()
        if (value) void navigate({ to: '/', search: { q: value } })
      }}
      className={`flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 transition-colors focus-within:border-line-strong ${large ? 'h-10' : 'h-8'}`}
    >
      <SearchIcon />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={large ? 'Steam ID, profile URL or player name' : 'Find a player…'}
        aria-label="Find a player"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
      />
    </form>
  )
}
