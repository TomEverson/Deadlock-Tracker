import type { ItemTag } from './types'

// What an item counters, read from its stat properties (deadlock-api
// /v1/assets/items) rather than a list of names, so new or rebalanced items
// are picked up after a patch. Pure.
//
// Only stats the in-game tooltip shows count: the raw property list also
// holds internal values (e.g. Refresher's hidden resists). Drawbacks to the
// owner (`negative_attribute`, e.g. Cheat Death's healing penalty) aren't
// anti-heal, and resist from an active (Warp Stone, Colossus) is temporary.

export interface TaggableItem {
  disabled?: boolean | null
  shopable?: boolean | null
  properties?: Record<string, { value?: string | number | null; negative_attribute?: boolean | null; tooltip_section?: string | null } | undefined> | null
  tooltip_sections?: { section_attributes: { properties?: string[] | null; important_properties?: string[] | null; elevated_properties?: string[] | null }[] }[] | null
}

const MIN_RESIST = 15 // below this the resist is a side stat, not a counter item

export function itemTags(item: TaggableItem): ItemTag[] {
  if (item.disabled || item.shopable === false) return []
  const shown = new Set(
    (item.tooltip_sections ?? []).flatMap((s) =>
      s.section_attributes.flatMap((a) => [...(a.properties ?? []), ...(a.important_properties ?? []), ...(a.elevated_properties ?? [])]),
    ),
  )
  const prop = (key: string) => {
    const p = item.properties?.[key]
    if (!p || !shown.has(key) || p.negative_attribute) return null
    const x = typeof p.value === 'number' ? p.value : parseFloat(p.value ?? '')
    return Number.isFinite(x) ? { value: x, active: p.tooltip_section === 'active' } : null
  }
  /** A resist the owner always has. */
  const resist = (key: string) => {
    const p = prop(key)
    return p != null && !p.active && p.value >= MIN_RESIST
  }
  const below0 = (key: string) => (prop(key)?.value ?? 0) < 0

  const tags: ItemTag[] = []
  if (below0('HealAmpReceivePenaltyPercent') || below0('HealAmpRegenPenaltyPercent')) tags.push('antiHeal')
  if (resist('BulletResist')) tags.push('bulletResist')
  if (resist('TechResist')) tags.push('spiritResist')
  if (below0('BulletArmorReduction') || below0('TechArmorDamageReduction')) tags.push('shred')
  if ((prop('StatusResistancePercent')?.value ?? 0) > 0) tags.push('statusResist')
  return tags
}
