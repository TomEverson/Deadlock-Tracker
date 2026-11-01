import type { HeroInfo, ItemInfo, RankInfo } from '../assets/types'
import type { MatchDetailData } from './validators/match-detail'

export type MatchDetailResult =
  | {
      kind: 'ok'
      detail: MatchDetailData
      heroes: Record<number, HeroInfo>
      items: Record<number, ItemInfo>
      avgRank: [RankInfo | null, RankInfo | null]
      /** The app's connected Steam account, for Win/Loss when no player is selected. */
      selfAccountId: number | null
    }
  | { kind: 'unavailable'; message: string }
