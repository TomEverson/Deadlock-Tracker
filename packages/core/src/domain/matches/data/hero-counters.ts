// Recommended counter items per enemy hero.
// Source: deadlockitembuilder.com/cheatsheet ("Updated Oct 2026"), five
// items per hero in the order listed. Matched by hero/item name at runtime;
// names that don't exist in the current item list are skipped, so a rename
// after a patch degrades quietly instead of breaking the analysis.

export const HERO_COUNTERS: Record<string, string[]> = {
  Abrams: ['Rebuttal', 'Reactive Barrier', 'Toxic Bullets', 'Decay', 'Healbane'],
  Apollo: ['Slowing Hex', 'Counterspell', 'Spellbreaker', 'Spirit Resilience', 'Silence Wave'],
  Baba: ['Dispel Magic', 'Spirit Resilience', 'Rebuttal', 'Cursed Relic', 'Knockdown'],
  Bebop: ['Dispel Magic', 'Counterspell', 'Indomitable', 'Unstoppable', 'Reactive Barrier'],
  Billy: ['Rebuttal', 'Slowing Hex', 'Dispel Magic', 'Counterspell', 'Unstoppable'],
  Calico: ['Slowing Hex', 'Silence Wave', 'Cursed Relic', 'Spirit Resilience', 'Spellbreaker'],
  Celeste: ['Knockdown', 'Slowing Hex', 'Dispel Magic', 'Disarming Hex', 'Spellbreaker'],
  'Deadman Danny': ['Spirit Shielding', 'Reactive Barrier', 'Slowing Hex', 'Knockdown', 'Spirit Resilience'],
  Drifter: ['Dispel Magic', 'Disarming Hex', 'Metal Skin', 'Counterspell', 'Divine Barrier'],
  Dynamo: ['Unstoppable', 'Rescue Beam', 'Knockdown', 'Cursed Relic', 'Ethereal Shift'],
  Graves: ['Monster Rounds', 'Ricochet', 'Dispel Magic', 'Spirit Burn', 'Healbane'],
  'Grey Talon': ['Rusted Barrel', 'Knockdown', 'Slowing Hex', 'Spellbreaker', 'Spirit Resilience'],
  Haze: ['Indomitable', 'Plated Armor', 'Metal Skin', 'Dispel Magic', 'Knockdown'],
  Holliday: ['Indomitable', 'Counterspell', 'Unstoppable', 'Slowing Hex', 'Spirit Resilience'],
  Infernus: ['Dispel Magic', 'Debuff Reducer', 'Counterspell', 'Warp Stone', 'Plated Armor'],
  Ivy: ['Counterspell', 'Unstoppable', 'Dispel Magic', 'Metal Skin', 'Knockdown'],
  Kelvin: ['Slowing Hex', 'Knockdown', 'Silence Wave', 'Healbane', 'Toxic Bullets'],
  'Lady Geist': ['Decay', 'Silence Wave', 'Cursed Relic', 'Dispel Magic', 'Healbane'],
  Lash: ['Ethereal Shift', 'Counterspell', 'Spellbreaker', 'Slowing Hex', 'Knockdown'],
  McGinnis: ['Monster Rounds', 'Spirit Resilience', 'Knockdown', 'Warp Stone', 'Metal Skin'],
  Mina: ['Slowing Hex', 'Silence Wave', 'Cursed Relic', 'Spirit Resilience', 'Spellbreaker'],
  Mirage: ['Dispel Magic', 'Unstoppable', 'Slowing Hex', 'Metal Skin', 'Reactive Barrier'],
  'Mo & Krill': ['Debuff Reducer', 'Indomitable', 'Slowing Hex', 'Knockdown', 'Toxic Bullets'],
  'Nurse Harrow': ['Healbane', 'Knockdown', 'Spirit Shielding', 'Disarming Hex', 'Unstoppable'],
  Paige: ['Dispel Magic', 'Unstoppable', 'Cursed Relic', 'Silence Wave', 'Reactive Barrier'],
  Paradox: ['Dispel Magic', 'Indomitable', 'Warp Stone', 'Counterspell', 'Debuff Reducer'],
  Pocket: ['Slowing Hex', 'Silence Wave', 'Cursed Relic', 'Counterspell', 'Divine Barrier'],
  'Rat King': ['Dispel Magic', 'Siphon Bullets', 'Decay', 'Metal Skin', 'Toxic Bullets'],
  Rem: ['Slowing Hex', 'Counterspell', 'Monster Rounds', 'Healbane', 'Toxic Bullets'],
  Seven: ['Dispel Magic', 'Knockdown', 'Cursed Relic', 'Disarming Hex', 'Spirit Resilience'],
  Shiv: ['Dispel Magic', 'Spellbreaker', 'Healbane', 'Spirit Burn', 'Debuff Reducer'],
  Silver: ['Metal Skin', 'Disarming Hex', 'Slowing Hex', 'Warp Stone', 'Return Fire'],
  Sinclair: ['Slowing Hex', 'Spellbreaker', 'Spirit Shielding', 'Counterspell', 'Unstoppable'],
  Solomon: ['Reactive Barrier', 'Spirit Shielding', 'Debuff Reducer', 'Spirit Resilience', 'Spellbreaker'],
  'The Doorman': ['Counterspell', 'Warp Stone', 'Unstoppable', 'Silence Wave', 'Cursed Relic'],
  Venator: ['Metal Skin', 'Disarming Hex', 'Rusted Barrel', 'Plated Armor', 'Suppressor'],
  Victor: ['Healbane', 'Toxic Bullets', 'Decay', 'Spirit Burn', 'Cursed Relic'],
  Vindicta: ['Knockdown', 'Slowing Hex', 'Phantom Strike', 'Dispel Magic', 'Counterspell'],
  Violet: ['Reactive Barrier', 'Spirit Shielding', 'Debuff Reducer', 'Dispel Magic', 'Spirit Resilience'],
  Viscous: ['Rebuttal', 'Cursed Relic', 'Knockdown', 'Silence Wave', 'Warp Stone'],
  Vyper: ['Dispel Magic', 'Metal Skin', 'Disarming Hex', 'Return Fire', 'Indomitable'],
  Warden: ['Extra Stamina', 'Dispel Magic', 'Unstoppable', 'Metal Skin', 'Plated Armor'],
  Wraith: ['Rusted Barrel', 'Unstoppable', 'Plated Armor', 'Disarming Hex', 'Metal Skin'],
  Yamato: ['Dispel Magic', 'Spirit Resilience', 'Spellbreaker', 'Silence Wave', 'Cursed Relic'],
}

/**
 * How a counter item answers a threat, from each item's in-game tooltip:
 * - disable: used on the enemy (stun, silence, disarm, slow, curse) — one
 *   teammate owning it covers the whole team.
 * - protect: only helps whoever owns it — the players the threat keeps
 *   killing need it themselves.
 * - save: cast on an ally (Rescue Beam, Divine Barrier) — one per team.
 * - antiHeal: reduces the enemy's healing.
 * - punish: extra damage against what the hero relies on (summons, max HP).
 */
export type CounterRole = 'disable' | 'protect' | 'save' | 'antiHeal' | 'punish'

export const COUNTER_ROLES: Record<string, CounterRole> = {
  Knockdown: 'disable',
  'Slowing Hex': 'disable',
  'Silence Wave': 'disable',
  'Cursed Relic': 'disable',
  'Disarming Hex': 'disable',
  'Phantom Strike': 'disable',
  'Rusted Barrel': 'disable',
  Suppressor: 'disable',
  Rebuttal: 'protect',
  'Reactive Barrier': 'protect',
  Counterspell: 'protect',
  Spellbreaker: 'protect',
  'Spirit Resilience': 'protect',
  'Spirit Shielding': 'protect',
  'Dispel Magic': 'protect',
  'Debuff Reducer': 'protect',
  Indomitable: 'protect',
  Unstoppable: 'protect',
  'Ethereal Shift': 'protect',
  'Plated Armor': 'protect',
  'Metal Skin': 'protect',
  'Warp Stone': 'protect',
  'Return Fire': 'protect',
  'Extra Stamina': 'protect',
  'Rescue Beam': 'save',
  'Divine Barrier': 'save',
  Healbane: 'antiHeal',
  'Toxic Bullets': 'antiHeal',
  Decay: 'antiHeal',
  'Spirit Burn': 'antiHeal',
  'Monster Rounds': 'punish',
  Ricochet: 'punish',
  'Siphon Bullets': 'punish',
}
