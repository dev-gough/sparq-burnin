import { randomUUID } from 'node:crypto'

/** Station-client validator: `[A-Za-z0-9._-]{1,64}`. */
export const STATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Opaque manufacturing station ID. Never derived from hostname, MAC,
 * fingerprint, request ID, IP, or secret. PK collisions are retried by the
 * enroll path, not here.
 */
export function allocateStationId(): string {
  const stationId = `MFG-${randomUUID()}`
  if (!STATION_ID_PATTERN.test(stationId)) {
    throw new Error(`allocator produced invalid station id: ${stationId}`)
  }
  return stationId
}
