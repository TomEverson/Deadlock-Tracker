import type { HeroInfo, ItemInfo, RankInfo } from '../../assets/types'

// Hero-aware coaching against top players: how a player performs on each
// hero compared with the best players of that hero (Ascendant+), judged by
// what the hero is played for. Pure. The numbers come from deadlock-api's
// analytics (player-stats/metrics, hero-stats, item-stats), fetched by the app.

/** One stat's distribution over single matches (deadlock-api player-stats/metrics). */
export interface Dist {
  avg: number
  percentile25: number
  percentile50: number
  percentile75: number
}

export type StatKey =
  | 'net_worth_per_min'
  | 'player_damage_per_min'
  | 'boss_damage_per_min'
  | 'neutral_damage_per_min'
  | 'deaths'
  | 'kda'
  | 'accuracy'
  | 'permanent_buffs'
  | 'teammate_healing'

interface StatDef {
  key: StatKey
  label: string
  /** Is a bigger number better? */
  higherIsBetter: boolean
  format: 'int' | 'dec' | 'pct'
  /** What to do about a gap, coach-style. */
  advice: string
}

export const STATS: StatDef[] = [
  { key: 'net_worth_per_min', label: 'Souls/min', higherIsBetter: true, format: 'int', advice: 'Last-hit every wave, clear camps between waves, and never walk around empty-handed.' },
  { key: 'player_damage_per_min', label: 'Hero damage/min', higherIsBetter: true, format: 'int', advice: 'Be in range for every fight and keep shooting — poke between fights too.' },
  { key: 'boss_damage_per_min', label: 'Objective damage/min', higherIsBetter: true, format: 'int', advice: 'Hit Guardians and Walkers after every won fight and whenever your wave is pushed in.' },
  { key: 'neutral_damage_per_min', label: 'Jungle damage/min', higherIsBetter: true, format: 'int', advice: 'Clear camps on every rotation between lanes instead of walking past them.' },
  { key: 'deaths', label: 'Deaths', higherIsBetter: false, format: 'dec', advice: 'Fight with your team, and back off when your cooldowns are down.' },
  { key: 'kda', label: 'KDA', higherIsBetter: true, format: 'dec', advice: 'Take fights you can win and finish kills.' },
  { key: 'accuracy', label: 'Accuracy', higherIsBetter: true, format: 'pct', advice: 'Aim for the body before headshots, and warm up in the sandbox.' },
  { key: 'permanent_buffs', label: 'Permanent buffs', higherIsBetter: true, format: 'dec', advice: 'Take Soul Urns, Sinner\'s Sacrifice and crates on your way around the map.' },
  { key: 'teammate_healing', label: 'Healing allies (per game)', higherIsBetter: true, format: 'int', advice: 'Stay near your team in fights so your heals land on them.' },
]

/** Hero totals in the benchmark pool (deadlock-api hero-stats). */
export interface HeroTotals {
  hero_id: number
  matches: number
  wins: number
  total_player_damage: number
  total_boss_damage: number
  total_net_worth: number
  total_neutral_damage: number
  total_deaths: number
}

/** What a hero is for: top players' averages on it vs top players on any hero. */
export interface HeroJob {
  /** 1 = average hero. */
  damage: number
  objectives: number
  jungle: number
  souls: number
  tags: string[]
}

export function heroJob(heroId: number, all: HeroTotals[]): HeroJob | null {
  const hero = all.find((h) => h.hero_id === heroId)
  const matches = all.reduce((a, h) => a + h.matches, 0)
  if (!hero || !hero.matches || !matches) return null
  const ratio = (k: keyof HeroTotals) => hero[k] / hero.matches / (all.reduce((a, h) => a + h[k], 0) / matches)
  const job = { damage: ratio('total_player_damage'), objectives: ratio('total_boss_damage'), jungle: ratio('total_neutral_damage'), souls: ratio('total_net_worth') }
  const tags: string[] = []
  if (job.objectives >= 1.3) tags.push(`Pusher (${job.objectives.toFixed(1)}× objective damage)`)
  if (job.jungle >= 1.3) tags.push(`Jungler (${job.jungle.toFixed(1)}× jungle damage)`)
  if (job.damage >= 1.2) tags.push(`Damage dealer (${job.damage.toFixed(1)}× hero damage)`)
  if (job.damage <= 0.85) tags.push(`Utility (${job.damage.toFixed(1)}× hero damage)`)
  return { ...job, tags }
}

export interface StatRow {
  key: StatKey
  label: string
  format: StatDef['format']
  you: number
  /** Top players' median. */
  top: number
  /** Top players' 75th percentile ("their good games"). */
  topHigh: number
  /**
   * You as a share of top level, where higher is always better: you ÷ top,
   * or top ÷ you for deaths. 1 = top level.
   */
  level: number
  /** What this hero is played for. */
  key_for_hero: boolean
}

export interface Diagnosis {
  tone: 'good' | 'bad'
  title: string
  detail: string
  weight: number
}

export interface BuildNote {
  itemId: number
  kind: 'skipped-core' | 'off-meta' | 'late'
  /** Share of top players' games on this hero that buy it. */
  benchRate: number
  /** Share of your games on this hero that bought it. */
  yourRate: number
  benchBuyTimeS: number | null
  yourBuyTimeS: number | null
}

export interface HeroCoaching {
  heroId: number
  heroName: string
  games: number
  wins: number
  /** Top players' win rate on the hero. */
  topWinRate: number | null
  /** Top players' games on the hero in the window. */
  topGames: number
  job: HeroJob | null
  stats: StatRow[]
  diagnosis: Diagnosis[]
  build: BuildNote[]
  /** Your games with item data (from local match details). */
  buildGames: number
}

export interface HeroInput {
  heroId: number
  heroName: string
  games: number
  wins: number
  /** Top players on this hero. */
  bench: Record<string, Dist>
  /** You on this hero. */
  you: Record<string, Dist>
  /** `matches` = top players' games on this hero that bought it (same filters as the hero totals). */
  benchItems: { item_id: number; matches: number; avg_buy_time_s?: number | null }[]
  /** Your purchases on this hero, one entry per game: itemId → first buy time. */
  yourBuilds: Map<number, number>[]
  isShopItem: (itemId: number) => boolean
  itemName: (itemId: number) => string
}

const share = (x: number) => `${Math.round(x * 100)}%`

function fmt(v: number, f: StatDef['format']): string {
  return f === 'pct' ? `${Math.round(v * 100)}%` : f === 'int' ? String(Math.round(v)) : v.toFixed(1)
}

export function coachHero(input: HeroInput, totals: HeroTotals[]): HeroCoaching {
  const { heroId, heroName, bench, you } = input
  const job = heroJob(heroId, totals)
  const heroRow = totals.find((h) => h.hero_id === heroId)
  const tops = `top ${heroName}s`

  // Ally healing only for heroes whose top players actually heal allies
  // (player_healing includes self-healing, so it would flag lifesteal heroes).
  const healer = (bench.teammate_healing?.percentile50 ?? 0) >= 1500
  const keyFor: Partial<Record<StatKey, boolean>> = {
    boss_damage_per_min: (job?.objectives ?? 1) >= 1.3,
    neutral_damage_per_min: (job?.jungle ?? 1) >= 1.3,
    player_damage_per_min: (job?.damage ?? 1) >= 1.2,
    teammate_healing: healer,
  }
  const stats: StatRow[] = STATS.flatMap((s) => {
    const b = bench[s.key]
    const y = you[s.key]
    if (!b || !y || b.percentile50 <= 0) return []
    if (s.key === 'teammate_healing' && !healer) return []
    const level = s.higherIsBetter ? y.avg / b.percentile50 : b.percentile50 / Math.max(0.5, y.avg)
    return [{ key: s.key, label: s.label, format: s.format, you: y.avg, top: b.percentile50, topHigh: b.percentile75, level, key_for_hero: !!keyFor[s.key] }]
  })
  const row = (k: StatKey) => stats.find((r) => r.key === k)
  const level = (k: StatKey) => row(k)?.level

  const diagnosis: Diagnosis[] = []
  const d = (tone: Diagnosis['tone'], weight: number, title: string, detail: string) => diagnosis.push({ tone, weight, title, detail })
  const def = (k: StatKey) => STATS.find((s) => s.key === k)!
  const vs = (k: StatKey) => `${fmt(row(k)!.you, row(k)!.format)} vs ${fmt(row(k)!.top, row(k)!.format)} for ${tops}`

  // ---- patterns (how the gaps fit together)
  const deaths = level('deaths')
  const souls = level('net_worth_per_min')
  const damage = level('player_damage_per_min')
  const objectives = level('boss_damage_per_min')
  const output = [souls, damage, objectives].filter((x): x is number => x != null)
  const outputAvg = output.length ? output.reduce((a, b) => a + b, 0) / output.length : null
  const tooSafe = deaths != null && outputAvg != null && deaths >= 1.3 && outputAvg < 0.65
  if (tooSafe) {
    d(
      'bad',
      95,
      `Playing ${heroName} too safe`,
      `You die ${fmt(row('deaths')!.you, 'dec')} times a game vs ${fmt(row('deaths')!.top, 'dec')} for ${tops}, but reach only ${share(damage ?? 0)} of their hero damage and ${share(objectives ?? 0)} of their objective damage. Top players accept more risk to farm, fight and push — dying a bit more is fine if it buys that.`,
    )
  }
  if (deaths != null && damage != null && deaths < 0.75 && damage < 0.7) {
    d('bad', 90, `Dying more than ${tops} without their damage`, `${vs('deaths')} deaths, with ${share(damage)} of their hero damage. ${def('deaths').advice}`)
  }
  if (souls != null && damage != null && souls >= 0.85 && damage < 0.6) {
    d('bad', 85, `Farming like a top ${heroName} but not fighting like one`, `${share(souls)} of their souls/min but ${share(damage)} of their hero damage. Turn your items into damage in fights.`)
  }

  // ---- gaps on the stats that matter for this hero (key ones first)
  for (const r of stats) {
    if (r.key === 'deaths' || r.key === 'kda') continue
    const threshold = r.key_for_hero ? 0.7 : r.key === 'accuracy' ? 0.8 : 0.6
    if (r.level >= threshold) continue
    if (tooSafe && (r.key === 'player_damage_per_min' || r.key === 'boss_damage_per_min') && !r.key_for_hero) continue
    const gap = 1 - r.level
    d(
      'bad',
      (r.key_for_hero ? 75 : 50) + gap * 30,
      r.key_for_hero ? `${r.label}: ${share(r.level)} of ${tops} — it's ${heroName}'s job` : `${r.label}: ${share(r.level)} of ${tops}`,
      `${vs(r.key)}${r.key_for_hero && job ? ` (top players on ${heroName} do ${(r.key === 'boss_damage_per_min' ? job.objectives : r.key === 'neutral_damage_per_min' ? job.jungle : job.damage).toFixed(1)}× the average hero's)` : ''}. ${def(r.key).advice}`,
    )
  }

  // ---- strengths: at or above top level
  for (const r of stats) {
    if (r.level < 0.95) continue
    if ((r.key === 'deaths' || r.key === 'kda') && tooSafe) continue // surviving is the symptom here, not a strength
    d('good', 30 + Math.min(r.level, 1.5) * 20 + (r.key_for_hero ? 15 : 0), `${r.label} at top level`, `${vs(r.key)}.`)
  }

  // ---- build vs top players
  const build: BuildNote[] = []
  const heroMatches = heroRow?.matches ?? 0
  const games = input.yourBuilds.length
  if (heroMatches > 0 && games >= 3) {
    const yourCount = new Map<number, number>()
    const yourTime = new Map<number, number[]>()
    for (const g of input.yourBuilds)
      for (const [id, t] of g) {
        yourCount.set(id, (yourCount.get(id) ?? 0) + 1)
        yourTime.set(id, [...(yourTime.get(id) ?? []), t])
      }
    const benchById = new Map(input.benchItems.filter((i) => input.isShopItem(i.item_id)).map((i) => [i.item_id, i]))
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? null
    for (const [id, b] of benchById) {
      const benchRate = Math.min(1, b.matches / heroMatches)
      const yourRate = (yourCount.get(id) ?? 0) / games
      const benchTime = b.avg_buy_time_s ?? null
      const yourT = yourTime.get(id) ? median(yourTime.get(id)!) : null
      if (benchRate >= 0.4 && yourRate <= 0.2) build.push({ itemId: id, kind: 'skipped-core', benchRate, yourRate, benchBuyTimeS: benchTime, yourBuyTimeS: yourT })
      else if (benchRate >= 0.3 && yourRate >= 0.5 && benchTime != null && yourT != null && yourT - benchTime >= 240)
        build.push({ itemId: id, kind: 'late', benchRate, yourRate, benchBuyTimeS: benchTime, yourBuyTimeS: yourT })
    }
    for (const [id, n] of yourCount) {
      if (!input.isShopItem(id) || n / games < 0.5) continue
      const benchRate = Math.min(1, (benchById.get(id)?.matches ?? 0) / heroMatches)
      if (benchRate < 0.08) build.push({ itemId: id, kind: 'off-meta', benchRate, yourRate: n / games, benchBuyTimeS: benchById.get(id)?.avg_buy_time_s ?? null, yourBuyTimeS: median(yourTime.get(id)!) })
    }
    build.sort((a, b) => b.benchRate - a.benchRate)
    const skipped = build.filter((b) => b.kind === 'skipped-core')
    if (skipped.length >= 2) {
      d(
        'bad',
        70,
        `Missing the items ${tops} build`,
        `${skipped
          .slice(0, 3)
          .map((b) => `${input.itemName(b.itemId)} (${share(b.benchRate)} of their games)`)
          .join(', ')}. See the build notes.`,
      )
    }
  }

  diagnosis.sort((a, b) => b.weight - a.weight)
  return {
    heroId,
    heroName,
    games: input.games,
    wins: input.wins,
    topWinRate: heroRow && heroRow.matches ? heroRow.wins / heroRow.matches : null,
    topGames: heroMatches,
    job,
    stats,
    diagnosis,
    build,
    buildGames: games,
  }
}

/** The top-player pool the benchmarks come from. */
export interface Benchmark {
  minBadge: number
  maxBadge: number
  /** Rank at the bottom of the pool (e.g. Ascendant). */
  rank: RankInfo | null
  windowDays: number
}

export interface HeroCoachingResult {
  benchmark: Benchmark
  heroes: HeroCoaching[]
  heroInfo: Record<number, HeroInfo>
  items: Record<number, ItemInfo>
  error: string | null
}
