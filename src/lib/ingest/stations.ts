import { loadConfig } from '@/lib/config'
import { getPool } from '@/lib/db'

export interface StationConfig {
  secret: string
}

export interface IngestServerConfig {
  maxBodyBytes: number
  maxSamples: number
  stations: Record<string, StationConfig>
}

const DEFAULT_MAX_BODY = 64 * 1024 * 1024
const DEFAULT_MAX_SAMPLES = 500_000

/**
 * Load ingest station config from config.json `ingest` section,
 * with optional override via INGEST_STATIONS_JSON env.
 */
export function loadIngestConfig(): IngestServerConfig {
  let maxBodyBytes = DEFAULT_MAX_BODY
  let maxSamples = DEFAULT_MAX_SAMPLES
  const stations: Record<string, StationConfig> = {}

  try {
    const config = loadConfig() as ReturnType<typeof loadConfig> & {
      ingest?: {
        maxBodyBytes?: number
        maxSamples?: number
        stations?: Record<string, { secret?: string }>
      }
    }
    if (config.ingest) {
      if (typeof config.ingest.maxBodyBytes === 'number') {
        maxBodyBytes = config.ingest.maxBodyBytes
      }
      if (typeof config.ingest.maxSamples === 'number') {
        maxSamples = config.ingest.maxSamples
      }
      if (config.ingest.stations) {
        for (const [id, s] of Object.entries(config.ingest.stations)) {
          if (s?.secret) {
            stations[id] = {
              secret: s.secret,
            }
          }
        }
      }
    }
  } catch {
    /* config may be missing ingest section */
  }

  const envJson = process.env.INGEST_STATIONS_JSON?.trim()
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Record<
        string,
        { secret?: string }
      >
      for (const [id, s] of Object.entries(parsed)) {
        if (s?.secret) {
          stations[id] = {
            secret: s.secret,
          }
        }
      }
    } catch {
      console.error('Failed to parse INGEST_STATIONS_JSON')
    }
  }

  if (process.env.INGEST_MAX_BODY_BYTES) {
    const n = Number(process.env.INGEST_MAX_BODY_BYTES)
    if (!Number.isNaN(n) && n > 0) maxBodyBytes = n
  }
  if (process.env.INGEST_MAX_SAMPLES) {
    const n = Number(process.env.INGEST_MAX_SAMPLES)
    if (!Number.isNaN(n) && n > 0) maxSamples = n
  }

  return { maxBodyBytes, maxSamples, stations }
}

export function getStation(
  stationId: string
): StationConfig | undefined {
  return loadIngestConfig().stations[stationId]
}

/**
 * DB-first station secret resolution (docs/STATION_ENROLLMENT_PLAN.md §3.3).
 *
 * StationCredentials (auto-enrolled / rotated secrets) wins over the legacy
 * config.json / INGEST_STATIONS_JSON path so a rotation beats a stale config
 * entry; revoked rows are skipped by the query — a revoked DB credential falls
 * back to config (legacy stations are never in the DB, so revocation of an
 * enrolled credential is effective).
 *
 * DB errors PROPAGATE: HMAC-verifying callers must fail closed (500), same as
 * the nonce store — never silently degrade auth to the config path when the
 * DB is unreachable.
 */
export async function resolveStationSecret(
  stationId: string
): Promise<StationConfig | undefined> {
  const r = await getPool().query(
    `SELECT secret FROM StationCredentials
     WHERE station_id = $1 AND revoked_at IS NULL`,
    [stationId]
  )
  if (r.rows.length > 0) {
    return { secret: r.rows[0].secret as string }
  }
  return getStation(stationId)
}
