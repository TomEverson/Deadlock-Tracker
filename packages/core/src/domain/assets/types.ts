export interface HeroInfo {
  id: number
  name: string
  icon: string | null
  card: string | null
}

/** A run of tooltip text; `hl` = the game's highlighted keyword. */
export interface ItemTextRun {
  t: string
  hl: boolean
}

export interface ItemStat {
  label: string
  value: string
  /** Shown prominently in the game's tooltip. */
  important: boolean
}

export interface ItemSection {
  kind: 'innate' | 'passive' | 'active'
  text: ItemTextRun[]
  stats: ItemStat[]
}

/** What an item counters; see item-tags.ts. */
export type ItemTag = 'antiHeal' | 'bulletResist' | 'spiritResist' | 'shred' | 'statusResist'

export interface ItemInfo {
  id: number
  name: string
  icon: string | null
  tier: number | null
  slot: 'weapon' | 'vitality' | 'spirit' | 'other'
  cost: number | null
  isActive: boolean
  sections: ItemSection[]
  tags: ItemTag[]
}

export interface RankInfo {
  badge: number
  tier: number
  subrank: number
  name: string
  color: string | null
  icon: string | null
}
