import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawDb } from './db'

// One-time import of the previous web version's database, saved to
// ~/.deadlock-tracker/legacy-web.sqlite when that version was removed.
// Same tables, so it's a straight copy.

const TABLES = ['player', 'player_match', 'match_detail', 'match_detail_attempt', 'sync_log'] as const
const LEGACY_FILE = join(homedir(), '.deadlock-tracker', 'legacy-web.sqlite')

/** The previous version's database, if this machine has one. */
export function findLegacyDatabase(): string | null {
  const file = process.env.DEADLOCK_LEGACY_DB ?? LEGACY_FILE
  return existsSync(file) ? file : null
}

export interface ImportResult {
  players: number
  matches: number
  details: number
}

export function importLegacyDatabase(file: string): ImportResult {
  // Work on a copy (with its WAL) so the original is never modified.
  const tmp = mkdtempSync(join(tmpdir(), 'deadlock-import-'))
  const copy = join(tmp, 'legacy.sqlite')
  copyFileSync(file, copy)
  for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, copy + ext)

  const raw = rawDb()
  const count = (t: string) => (raw.prepare(`SELECT COUNT(*) FROM ${t}`).pluck().get() as number) ?? 0
  const before = { players: count('player'), matches: count('player_match'), details: count('match_detail') }
  raw.prepare('ATTACH DATABASE ? AS legacy').run(copy)
  try {
    raw.transaction(() => {
      for (const table of TABLES) {
        const exists = raw.prepare("SELECT 1 FROM legacy.sqlite_master WHERE type = 'table' AND name = ?").get(table)
        if (!exists) continue
        const cols = (t: string, schema: string) => (raw.prepare(`PRAGMA ${schema}.table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
        const legacyCols = new Set(cols(table, 'legacy'))
        const shared = cols(table, 'main').filter((c) => legacyCols.has(c) && !(table === 'sync_log' && c === 'id'))
        const list = shared.join(', ')
        raw.exec(`INSERT OR IGNORE INTO main.${table} (${list}) SELECT ${list} FROM legacy.${table}`)
      }
    })()
  } finally {
    raw.exec('DETACH DATABASE legacy')
    rmSync(tmp, { recursive: true, force: true })
  }
  return { players: count('player') - before.players, matches: count('player_match') - before.matches, details: count('match_detail') - before.details }
}
