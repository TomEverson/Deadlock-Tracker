import type { ItemSection, ItemStat, ItemTextRun } from './types'

// Item tooltip parsing for the assets API's upgrade items (deadlock-api
// /v1/assets/items): tooltip sections, highlighted description text and
// formatted stat lines. Pure, shared by the app and anything else that
// shows item details.

export interface RawProperty {
  label?: string | null
  value?: string | number | null
  prefix?: string | null
  postfix?: string | null
}

export interface RawItem {
  properties?: Record<string, RawProperty> | null
  tooltip_sections?:
    | {
        section_type?: string | null
        section_attributes: {
          loc_string?: string | null
          properties?: string[] | null
          important_properties?: string[] | null
          elevated_properties?: string[] | null
        }[]
      }[]
    | null
}


/** Tooltip HTML → text runs, keeping the game's `highlight` spans. */
function toTextRuns(html: string | null | undefined): ItemTextRun[] {
  if (!html) return []
  const clean = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
  const runs: ItemTextRun[] = []
  const re = /<span class="highlight">(.*?)<\/span>/gi
  let last = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) runs.push({ t: clean(html.slice(last, m.index)), hl: false })
    runs.push({ t: clean(m[1] ?? ''), hl: true })
    last = m.index + m[0].length
  }
  if (last < html.length) runs.push({ t: clean(html.slice(last)), hl: false })
  return runs.filter((r) => r.t.length > 0)
}

/** "210" + "{s:sign}" → "+210"; "-40" + "%" → "−40%"; "11m" + "m" → "11m". Null for unset (0). */
function formatStat(p: RawProperty): string | null {
  let v = String(p.value ?? '').trim()
  // Some values arrive with their unit attached ("2.0m", "11m"): split it off.
  const unit = /^(-?\d+(?:\.\d+)?)\s*([a-z%]*)$/i.exec(v)
  if (unit && (!unit[2] || (p.postfix ?? '').trim().startsWith(unit[2]))) v = unit[1]!
  if (!v || Number(v) === 0) return null
  const num = Number(v)
  if (Number.isFinite(num)) {
    v = String(Number(num.toFixed(2)))
    if (num > 0 && p.prefix?.includes('{s:sign}')) v = `+${v}`
    if (num < 0) v = `−${v.slice(1)}`
  }
  const post = (p.postfix ?? '').trim()
  if (post && !v.endsWith(post)) v += post.startsWith('%') || post.length <= 2 ? post : ` ${post}`
  return v
}

export function toItemSections(i: RawItem): ItemSection[] {
  const props = i.properties ?? {}
  return (i.tooltip_sections ?? []).map((s) => {
    const kind: ItemSection['kind'] = s.section_type === 'innate' ? 'innate' : s.section_type === 'active' ? 'active' : 'passive'
    const stats: ItemStat[] = []
    const text: ItemTextRun[] = []
    for (const a of s.section_attributes) {
      text.push(...toTextRuns(a.loc_string))
      const add = (keys: string[] | null | undefined, important: boolean) => {
        for (const k of keys ?? []) {
          const p = props[k]
          const value = p && formatStat(p)
          if (p && value) stats.push({ label: p.label ?? k, value, important })
        }
      }
      add(a.elevated_properties, true)
      add(a.important_properties, true)
      add(a.properties, false)
    }
    return { kind, text, stats }
  })
}
