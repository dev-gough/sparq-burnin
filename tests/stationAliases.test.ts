import { describe, it, expect } from 'vitest'
import {
  normalizeStationAlias,
  stationDisplayName,
} from '@/lib/stationAliases'

describe('station display aliases', () => {
  it('uses the alias when present, otherwise the station id', () => {
    const id = 'MFG-da16fcb5-f0a9-4683-a7e4-44f3236cde98'
    expect(stationDisplayName(id, {})).toBe(id)
    expect(stationDisplayName(id, { [id]: 'Line 3' })).toBe('Line 3')
  })

  it('clears aliases that are empty or identical to the station id', () => {
    const id = 'MFG-aaaa'
    expect(normalizeStationAlias(id, '  ')).toBeNull()
    expect(normalizeStationAlias(id, id)).toBeNull()
    expect(normalizeStationAlias(id, '  Line 3  ')).toBe('Line 3')
  })
})
