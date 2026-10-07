import { describe, expect, it, vi } from 'vitest'
import { resolveCsvSerial } from '../src/lib/ingest/csvSerial'

describe('CSV serial recovery', () => {
  it.each([
    ['190826350334', '1.90826E+11'],
    ['190826350340', '1.90826E+11'],
    ['190826350350', '1.90826E+11'],
    ['190826350369', '1.91E+11'],
    ['190826350447', '1.90826E+11'],
  ])('recovers the full serial %s without expanding rounded digits', (serial, raw) => {
    const warn = vi.fn()
    expect(resolveCsvSerial(raw, `/queue/${serial}_2026-09-08_10-17-44.csv`, warn)).toBe(serial)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('leaves ordinary serials unchanged, including leading zeroes', () => {
    expect(resolveCsvSerial('001234567890', '190826350334_2026-09-08_10-17-44.csv')).toBe('001234567890')
    expect(resolveCsvSerial(undefined, '190826350334_2026-09-08_10-17-44.csv')).toBe('')
  })

  it.each([
    ['1.90826E+11', '290826350334_2026-09-08_10-17-44.csv'],
    ['1.90827E+11', '190826350334_2026-09-08_10-17-44.csv'],
    ['1.90826350335E+11', '190826350334_2026-09-08_10-17-44.csv'],
    ['1.90826E+11', 'unknown.csv'],
    ['1.91E+20', '190826350334000000000_2026-09-08_10-17-44.csv'],
  ])('rejects an unsupported or conflicting identity: %s / %s', (raw, filename) => {
    expect(() => resolveCsvSerial(raw, filename)).toThrow('Cannot safely recover')
  })
})
