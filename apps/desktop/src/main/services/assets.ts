import { fetchHeroes, fetchRanks, fetchUpgradeItems } from './deadlock-api'
import type { HeroInfo, ItemInfo, RankInfo } from '@deadlock/core/domain/assets/types'
import { toItemSections } from '@deadlock/core/domain/assets/item-tooltip'
import { itemTags } from '@deadlock/core/domain/assets/item-tags'

// Reference data changes once per patch. The fetches are edge-cached for a
// day (see deadlock-api.ts); this per-isolate memo just avoids re-parsing
// the same JSON on every request within a warm isolate.
const MEMO_TTL_MS = 60 * 60 * 1000

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let value: { at: number; promise: Promise<T> } | null = null
  return () => {
    if (!value || Date.now() - value.at > MEMO_TTL_MS) {
      const promise = load()
      value = { at: Date.now(), promise }
      // Don't cache failures.
      promise.catch(() => {
        if (value?.promise === promise) value = null
      })
    }
    return value.promise
  }
}

export const getHeroMap = memo(async (): Promise<Map<number, HeroInfo>> => {
  const heroes = await fetchHeroes()
  return new Map(
    heroes.map((h) => [
      h.id,
      {
        id: h.id,
        name: h.name,
        icon: h.images?.icon_image_small_webp ?? h.images?.icon_image_small ?? null,
        card: h.images?.icon_hero_card_webp ?? null,
      },
    ]),
  )
})

function toSlot(slot: string | null | undefined): ItemInfo['slot'] {
  return slot === 'weapon' || slot === 'vitality' || slot === 'spirit' ? slot : 'other'
}

export const getItemMap = memo(async (): Promise<Map<number, ItemInfo>> => {
  const items = await fetchUpgradeItems()
  return new Map(
    items.map((i) => [
      i.id,
      {
        id: i.id,
        name: i.name,
        icon: i.shop_image_webp ?? i.image_webp ?? i.image ?? null,
        tier: i.item_tier ?? null,
        slot: toSlot(i.item_slot_type),
        cost: i.cost ?? null,
        isActive: i.activation != null && i.activation !== 'passive',
        sections: toItemSections(i),
        tags: itemTags(i),
      },
    ]),
  )
})

const getRankTiers = memo(fetchRanks)

/** badge = tier * 10 + subrank (e.g. 74 = Emissary 4). 0/null = unranked. */
export async function getRankInfo(badge: number | null | undefined): Promise<RankInfo | null> {
  if (!badge) return null
  const tier = Math.floor(badge / 10)
  const subrank = badge % 10
  const tiers = await getRankTiers().catch(() => [])
  const t = tiers.find((x) => x.tier === tier)
  return {
    badge,
    tier,
    subrank,
    name: t?.name ?? `Tier ${tier}`,
    color: t?.color ?? null,
    icon: t?.images[`small_subrank${subrank}_webp`] ?? t?.images[`small_subrank${subrank}`] ?? t?.images.small_webp ?? null,
  }
}

export function heroOrFallback(map: Map<number, HeroInfo>, heroId: number): HeroInfo {
  return map.get(heroId) ?? { id: heroId, name: `Hero ${heroId}`, icon: null, card: null }
}
