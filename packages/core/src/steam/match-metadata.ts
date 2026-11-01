import { spawnSync } from 'node:child_process'
import { zstdDecompressSync } from 'node:zlib'
import { matchMetadataSchema, type MatchMetadata } from '../domain/matches/services/trim-metadata'
import { DEADLOCK_APP_ID, GcError, type MatchSalts } from './gc'
import { MatchMetaData, MatchMetaDataContents, decode } from './proto'

const DOWNLOAD_TIMEOUT_MS = 30_000
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const BZ2_MAGIC = Buffer.from('BZh')

export function metadataUrl(s: MatchSalts): string {
  return `http://replay${s.clusterId}.valve.net/${DEADLOCK_APP_ID}/${s.matchId}_${s.metadataSalt}.meta.bz2`
}

// The file keeps its .meta.bz2 name, but Valve switched the body from bzip2
// to Zstandard in July 2026; older matches can still be bzip2.
function decompress(body: Buffer): Buffer {
  if (body.subarray(0, 4).equals(ZSTD_MAGIC)) return zstdDecompressSync(body)
  if (body.subarray(0, 3).equals(BZ2_MAGIC)) {
    const out = spawnSync('bzip2', ['-dc'], { input: body, maxBuffer: 256 * 1024 * 1024 })
    if (out.status !== 0 || out.error) throw new GcError('gc_error', `bzip2 failed: ${out.error?.message ?? out.stderr.toString().slice(0, 200)}`)
    return out.stdout
  }
  throw new GcError('gc_error', `Unknown metadata compression (first bytes ${body.subarray(0, 4).toString('hex')})`)
}

/** Decode a metadata file body (Zstandard or bzip2) into the validated match info. */
export function decodeMatchMetadata(raw: Buffer, matchId: number): MatchMetadata {
  const body = decompress(raw)
  const outer = MatchMetaData.decode(body)
  const details = MatchMetaData.toObject(outer, { bytes: Buffer }).match_details
  if (!Buffer.isBuffer(details) || details.length === 0) throw new GcError('gc_error', `Match ${matchId} metadata file has no match details`)

  const contents = decode(MatchMetaDataContents, details)
  const info = typeof contents === 'object' && contents !== null && 'match_info' in contents ? contents.match_info : undefined
  const parsed = matchMetadataSchema.safeParse(info)
  if (!parsed.success) throw new GcError('gc_error', `Unexpected metadata for match ${matchId}: ${parsed.error.message.slice(0, 200)}`)
  return parsed.data
}

/** Download a match's metadata file from Valve's replay servers and decode it. */
export async function downloadMatchMetadata(salts: MatchSalts): Promise<MatchMetadata> {
  const url = metadataUrl(salts)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (err) {
    throw new GcError('gc_error', `Downloading match ${salts.matchId} from Valve failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new GcError('gc_error', `Valve's replay server returned ${res.status} for match ${salts.matchId}`)

  return decodeMatchMetadata(Buffer.from(await res.arrayBuffer()), salts.matchId)
}
