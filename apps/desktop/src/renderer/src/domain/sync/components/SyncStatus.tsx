import { TimeAgo } from '~/components/ui'
import type { Freshness } from '@deadlock/core/domain/players/types'
import { useSyncStatus } from '../hooks'

/** Player page: how fresh this player's data is, and a button to sync them now. */
export function SyncStatus({ accountId, freshness, isSelf }: { accountId: number; freshness: Freshness; isSelf: boolean }) {
  const status = useSyncStatus()
  const running = status?.state === 'running'
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span>
        {freshness.lastSyncedAt ? (
          <>
            Synced <TimeAgo at={freshness.lastSyncedAt} />
          </>
        ) : (
          'Never synced'
        )}
      </span>
      {status?.steam && (
        <button
          type="button"
          disabled={running}
          onClick={() => void window.api.sync.run(isSelf ? {} : { accountId })}
          title={isSelf ? 'Sync you and your friends' : 'Sync this player (needs to be your Steam friend)'}
          className="flex h-7 items-center rounded-md border border-line px-2.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {running ? 'Syncing…' : 'Sync'}
        </button>
      )}
    </div>
  )
}
