import { describe, it, expect } from 'vitest'
import {
  isOverallStatus,
  NON_OUTCOME_STATUSES,
  outcomeStatusSql,
  OVERALL_STATUSES,
  overallStatusBadgeVariant,
} from '@/lib/overall-status'

describe('overall-status', () => {
  it('lists PASS FAIL INVALID RETEST', () => {
    expect([...OVERALL_STATUSES]).toEqual([
      'PASS',
      'FAIL',
      'INVALID',
      'RETEST',
    ])
  })

  it('treats INVALID and RETEST as non-outcome for rates / latest-per-SN', () => {
    expect([...NON_OUTCOME_STATUSES]).toEqual(['INVALID', 'RETEST'])
    expect(outcomeStatusSql('t.overall_status')).toBe(
      "t.overall_status NOT IN ('INVALID', 'RETEST')"
    )
  })

  it('accepts only known statuses', () => {
    expect(isOverallStatus('RETEST')).toBe(true)
    expect(isOverallStatus('PASS')).toBe(true)
    expect(isOverallStatus('unknown')).toBe(false)
    expect(isOverallStatus('')).toBe(false)
  })

  it('maps RETEST to outline badge variant', () => {
    expect(overallStatusBadgeVariant('RETEST')).toBe('outline')
    expect(overallStatusBadgeVariant('FAIL')).toBe('destructive')
    expect(overallStatusBadgeVariant('PASS')).toBe('default')
  })
})
