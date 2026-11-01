import type { ReactNode } from 'react'
import { Avatar, RankBadge } from '~/components/ui'
import type { RankInfo } from '@deadlock/core/domain/assets/types'
import type { PlayerProfile } from '@deadlock/core/domain/players/types'

export function PlayerHeader({ profile, rank, actions }: { profile: PlayerProfile; rank: RankInfo | null; actions: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar src={profile.avatar} name={profile.name} size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{profile.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
            <RankBadge rank={rank} size={16} />
            {profile.profileUrl && (
              <a href={profile.profileUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
                Steam profile ↗
              </a>
            )}
            <span className="num text-xs">ID {profile.accountId}</span>
          </div>
        </div>
      </div>
      {actions}
    </div>
  )
}
