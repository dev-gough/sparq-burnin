/**
 * Pins the shared result-row rules and the MULTI-ROW PRIORITY-SELECTION RULE
 * (src/lib/ingest/validate.ts). The station client's `_row_priority`
 * (Zigbee_UART_Interface, burnin/dashboard_ingest.py) mirrors these semantics
 * — if these tests need changing, the station must change too (flag it in
 * both repos' plan files).
 */
import { describe, it, expect } from 'vitest'
import { evaluateResultRow, selectBestResult } from '@/lib/ingest/validate'

const DEBUG_FW = '1.11.11'

function row(overrides: Partial<Parameters<typeof evaluateResultRow>[0]> = {}) {
  return {
    serialNumber: '107000123456',
    startTime: '2025-06-15T09:00:00',
    endTime: '2025-06-16T09:00:00', // 24 h
    firmwareVersion: '1.2.3',
    overallStatus: 'PASS',
    ...overrides,
  }
}

describe('evaluateResultRow priorities', () => {
  it('valid row → priority 4, status preserved', () => {
    const e = evaluateResultRow(row(), DEBUG_FW)
    expect(e.priority).toBe(4)
    expect(e.overallStatus).toBe('PASS')
    expect(e.invalidReason).toBe('')
    expect(e.startTimeUtc).toBe('2025-06-15T03:30:00.000Z')
    expect(e.endTimeUtc).toBe('2025-06-16T03:30:00.000Z')
  })

  it('debug firmware → INVALID, priority 3 (server-side-only demotion)', () => {
    const e = evaluateResultRow(row({ firmwareVersion: DEBUG_FW }), DEBUG_FW)
    expect(e.priority).toBe(3)
    expect(e.overallStatus).toBe('INVALID')
    expect(e.invalidReason).toBe('Debug firmware version')
  })

  it('source-data INVALID with no rule fired → priority 3', () => {
    const e = evaluateResultRow(row({ overallStatus: 'INVALID' }), DEBUG_FW)
    expect(e.priority).toBe(3)
    expect(e.overallStatus).toBe('INVALID')
  })

  it('duration < 2 h → INVALID, priority 2', () => {
    const e = evaluateResultRow(
      row({ endTime: '2025-06-15T10:00:00' }),
      DEBUG_FW
    )
    expect(e.priority).toBe(2)
    expect(e.overallStatus).toBe('INVALID')
    expect(e.invalidReason).toBe('Duration less than 2 hours')
  })

  it('start > end → INVALID, priority 1 (beats the short-duration rule)', () => {
    const e = evaluateResultRow(
      row({ startTime: '2025-06-16T09:00:00', endTime: '2025-06-15T09:00:00' }),
      DEBUG_FW
    )
    expect(e.priority).toBe(1)
    expect(e.overallStatus).toBe('INVALID')
    expect(e.invalidReason).toBe('Invalid date range')
  })
})

describe('selectBestResult', () => {
  const r = (serialNumber: string, priority: number) => ({
    serialNumber,
    startTime: '2025-06-15T09:00:00',
    priority,
  })

  it('empty input → null', () => {
    expect(selectBestResult([])).toBeNull()
  })

  it('single row is processed regardless of validity (even priority 1)', () => {
    expect(selectBestResult([r('A', 1)])?.serialNumber).toBe('A')
  })

  it('multi-row: highest priority wins', () => {
    const rows = [r('low', 2), r('high', 4), r('mid', 3)]
    expect(selectBestResult(rows)?.serialNumber).toBe('high')
  })

  it('multi-row tie: FIRST row in file order wins (stable sort)', () => {
    const rows = [r('first', 4), r('second', 4)]
    expect(selectBestResult(rows)?.serialNumber).toBe('first')
  })

  it('multi-row, all priority 1 → whole file skipped (null + warn)', () => {
    const warnings: string[] = []
    const selected = selectBestResult([r('A', 1), r('B', 1)], {
      fileLabel: 'results.csv',
      warn: (m) => warnings.push(m),
    })
    expect(selected).toBeNull()
    expect(warnings.some((w) => w.includes('results.csv'))).toBe(true)
  })

  it('multi-row with a P1 majority but one better row → better row wins', () => {
    const rows = [r('bad1', 1), r('ok', 2), r('bad2', 1)]
    expect(selectBestResult(rows)?.serialNumber).toBe('ok')
  })
})
