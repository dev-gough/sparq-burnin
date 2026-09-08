import { describe, it, expect } from 'vitest'
import {
  allocateStationId,
  STATION_ID_PATTERN,
} from '@/lib/allocateStationId'

describe('allocateStationId', () => {
  it('always satisfies the station-client station-id validator', () => {
    for (let i = 0; i < 50; i++) {
      const id = allocateStationId()
      expect(id).toMatch(STATION_ID_PATTERN)
      expect(id.startsWith('MFG-')).toBe(true)
      expect(id.length).toBeLessThanOrEqual(64)
      expect(id.length).toBe(40)
    }
  })

  it('does not collide across a modest sample', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const id = allocateStationId()
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })
})
