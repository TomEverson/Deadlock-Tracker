// Shared (client + server) formatting helpers.

export function timeAgo(input: Date | string | number, now = Date.now()): string {
  const t = typeof input === 'number' ? input : new Date(input).getTime()
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatSouls(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function kdaRatio(k: number, d: number, a: number): string {
  return ((k + a) / Math.max(1, d)).toFixed(2)
}

export function pct(part: number, whole: number): string {
  if (whole === 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

// ECitadelGameMode / ECitadelMatchMode from the game's protobufs.
export function modeLabel(gameMode: number, matchMode: number): string {
  if (gameMode === 4) return 'Street Brawl'
  switch (matchMode) {
    case 4:
      return 'Ranked'
    case 1:
      return 'Unranked'
    case 2:
      return 'Private'
    case 3:
      return 'Bots'
    case 7:
      return 'Hero Labs'
    default:
      return 'Other'
  }
}

export const TEAM_NAMES = ['Hidden King', 'Archmother'] as const

export function teamName(team: number): string {
  return TEAM_NAMES[team] ?? `Team ${team}`
}
