import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { SyncStatus } from '../../../../shared/api'

/** Live sync status from the main process. */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.sync.status().then((s) => alive && setStatus(s))
    const off = window.api.on('sync:status', setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Refresh once the Steam pause expires, so buttons re-enable without a reload.
  useEffect(() => {
    const until = status?.backoffUntil
    if (!until) return
    const ms = new Date(until).getTime() - Date.now()
    if (ms <= 0) return
    const timer = setTimeout(() => {
      void window.api.sync.status().then(setStatus)
    }, ms + 1000)
    return () => clearTimeout(timer)
  }, [status?.backoffUntil])

  return status
}

/** Reload route data whenever local data changes (sync finished, data:changed…). */
export function useReloadOnDataChange(): void {
  const router = useRouter()
  useEffect(() => window.api.on('data:changed', () => void router.invalidate()), [router])
}
