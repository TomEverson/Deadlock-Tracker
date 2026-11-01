import bz2 from 'bz2'
import { decompress as unzstd } from 'fzstd'
import { matchMetadataSchema, type MatchMetadata } from '../domain/matches/services/trim-metadata'

// Valve's match metadata file ({match}_{salt}.meta.bz2 on replayNNN.valve.net),
// decoded without protobufjs: pure JS, no runtime code generation, so it runs
// the same in the desktop app and in a Cloudflare Worker. Only the fields
// the app uses are read (field numbers from SteamDatabase/Protobufs,
// deadlock/citadel_gcmessages_common.proto); everything else is skipped.

export const DEADLOCK_APP_ID = 1422450

export interface MetadataLocation {
  matchId: number
  clusterId: number
  metadataSalt: number
}

export const metadataUrl = (l: MetadataLocation) => `http://replay${l.clusterId}.valve.net/${DEADLOCK_APP_ID}/${l.matchId}_${l.metadataSalt}.meta.bz2`

export class MetadataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetadataError'
  }
}

// ------------------------------------------------------------ decompression

/** The body kept its .bz2 name, but Valve switched to Zstandard in July 2026; older files are bzip2. */
export function decompressMetadata(body: Uint8Array): Uint8Array {
  if (body[0] === 0x28 && body[1] === 0xb5 && body[2] === 0x2f && body[3] === 0xfd) return unzstd(body)
  if (body[0] === 0x42 && body[1] === 0x5a && body[2] === 0x68) return bz2.decompress(body)
  throw new MetadataError(`Unknown metadata compression (first bytes ${[...body.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('')})`)
}

// ------------------------------------------------------- minimal protobuf

type Field = { name: string; kind: 'uint' } | { name: string; kind: 'bytes' } | { name: string; kind: 'message'; schema: Schema; repeated?: true }
type Schema = Record<number, Field>
type Decoded = Record<string, unknown>

const u = (name: string): Field => ({ name, kind: 'uint' })
const many = (name: string, schema: Schema): Field => ({ name, kind: 'message', schema, repeated: true })

const DEATH: Schema = { 1: u('game_time_s'), 9: u('killer_player_slot'), 12: u('death_duration_s') }
const ITEM: Schema = { 1: u('game_time_s'), 2: u('item_id'), 4: u('sold_time_s') }
const STATS: Schema = {
  1: u('time_stamp_s'), 2: u('net_worth'), 3: u('gold_player'), 4: u('gold_player_orbs'), 5: u('gold_lane_creep_orbs'),
  6: u('gold_neutral_creep_orbs'), 7: u('gold_boss'), 8: u('gold_boss_orb'), 9: u('gold_treasure'), 10: u('gold_denied'),
  11: u('gold_death_loss'), 12: u('gold_lane_creep'), 13: u('gold_neutral_creep'), 14: u('kills'), 15: u('deaths'),
  16: u('assists'), 17: u('creep_kills'), 18: u('neutral_kills'), 19: u('possible_creeps'), 21: u('player_damage'),
  23: u('boss_damage'), 24: u('denies'), 25: u('player_healing'), 27: u('self_healing'), 28: u('player_damage_taken'),
  32: u('shots_hit'), 33: u('shots_missed'), 36: u('hero_bullets_hit'), 37: u('hero_bullets_hit_crit'), 42: u('damage_mitigated'), 43: u('level'),
}
const PLAYER: Schema = {
  1: u('account_id'), 2: u('player_slot'), 3: many('death_details', DEATH), 4: many('items', ITEM), 5: many('stats', STATS),
  6: u('team'), 8: u('kills'), 9: u('deaths'), 10: u('assists'), 11: u('net_worth'), 12: u('hero_id'), 13: u('last_hits'),
  14: u('denies'), 17: u('assigned_lane'), 18: u('level'), 23: u('abandon_match_time_s'), 28: u('mvp_rank'),
}
const OBJECTIVE: Schema = { 2: u('destroyed_time_s'), 8: u('first_damage_time_s'), 9: u('team_objective_id'), 10: u('team') }
const MID_BOSS: Schema = { 1: u('team_killed'), 2: u('team_claimed'), 3: u('destroyed_time_s') }
const MATCH_INFO: Schema = {
  1: u('duration_s'), 2: u('match_outcome'), 3: u('winning_team'), 4: many('players', PLAYER), 5: u('start_time'), 6: u('match_id'),
  9: u('game_mode'), 10: u('match_mode'), 11: many('objectives', OBJECTIVE), 19: many('mid_boss', MID_BOSS),
  23: u('average_badge_team0'), 24: u('average_badge_team1'),
}
const CONTENTS: Schema = { 2: { name: 'match_info', kind: 'message', schema: MATCH_INFO } }
const OUTER: Schema = { 2: { name: 'match_details', kind: 'bytes' }, 3: u('match_id') }

function decode(buf: Uint8Array, schema: Schema): Decoded {
  // Defaults like protobufjs toObject({ defaults: true }): scalars 0, repeated [].
  const out: Decoded = {}
  for (const f of Object.values(schema)) out[f.name] = f.kind === 'uint' ? 0 : f.kind === 'message' && f.repeated ? [] : undefined

  let pos = 0
  const varint = (): number => {
    let result = 0
    let mul = 1
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new MetadataError('Truncated varint')
      const b = buf[pos++]!
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
      mul *= 128
    }
    throw new MetadataError('Varint too long')
  }

  while (pos < buf.length) {
    const key = varint()
    const field = schema[Math.floor(key / 8)]
    const wire = key & 7
    if (wire === 0) {
      const v = varint()
      if (field?.kind === 'uint') out[field.name] = v
    } else if (wire === 2) {
      const len = varint()
      if (pos + len > buf.length) throw new MetadataError('Truncated field')
      const chunk = buf.subarray(pos, pos + len)
      pos += len
      if (field?.kind === 'bytes') out[field.name] = chunk
      else if (field?.kind === 'message') {
        const msg = decode(chunk, field.schema)
        if (field.repeated) (out[field.name] as Decoded[]).push(msg)
        else out[field.name] = msg
      }
    } else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw new MetadataError(`Unsupported wire type ${wire}`)
  }
  return out
}

/** Decompressed metadata file → the match info the app uses (validated). */
export function decodeMetadata(raw: Uint8Array, expectedMatchId?: number): MatchMetadata {
  const details = decode(raw, OUTER).match_details
  if (!(details instanceof Uint8Array) || details.length === 0) throw new MetadataError('Metadata file has no match details')
  const parsed = matchMetadataSchema.safeParse(decode(details, CONTENTS).match_info)
  if (!parsed.success) throw new MetadataError(`Unexpected match metadata: ${parsed.error.message.slice(0, 200)}`)
  if (expectedMatchId !== undefined && parsed.data.match_id !== expectedMatchId) throw new MetadataError(`Metadata is for match ${parsed.data.match_id}, not ${expectedMatchId}`)
  return parsed.data
}

/** Download, decompress and decode a match's metadata from Valve's replay servers. No Steam account or Game Coordinator request involved. */
export async function fetchMatchMetadata(location: MetadataLocation, timeoutMs = 30_000): Promise<MatchMetadata> {
  let res: Response
  try {
    res = await fetch(metadataUrl(location), { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new MetadataError(`Downloading match ${location.matchId} from Valve failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new MetadataError(`Valve's replay server returned ${res.status} for match ${location.matchId}`)
  return decodeMetadata(decompressMetadata(new Uint8Array(await res.arrayBuffer())), location.matchId)
}
