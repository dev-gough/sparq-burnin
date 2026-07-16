import { loadConfig } from '@/lib/config'

export interface StationConfig {
  secret: string
  enabled: boolean
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
        stations?: Record<string, { secret?: string; enabled?: boolean }>
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
              enabled: s.enabled !== false,
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
        { secret?: string; enabled?: boolean }
      >
      for (const [id, s] of Object.entries(parsed)) {
        if (s?.secret) {
          stations[id] = {
            secret: s.secret,
            enabled: s.enabled !== false,
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
