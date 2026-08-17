import { describe, it, expect } from 'vitest'
import { isSafeLogFileName } from '@/lib/opsLogReader'

describe('ops log-files names', () => {
  it('accepts dated app/next/email files', () => {
    expect(isSafeLogFileName('app-2026-08-17.log')).toBe(true)
    expect(isSafeLogFileName('next-2026-08-17.log')).toBe(true)
    expect(isSafeLogFileName('send-email-2026-08-17.log')).toBe(true)
  })

  it('rejects path traversal and unclassified names', () => {
    expect(isSafeLogFileName('../app-2026-08-17.log')).toBe(false)
    expect(isSafeLogFileName('dir/app-2026-08-17.log')).toBe(false)
    expect(isSafeLogFileName('next-dev.log')).toBe(false)
    expect(isSafeLogFileName('')).toBe(false)
  })
})
