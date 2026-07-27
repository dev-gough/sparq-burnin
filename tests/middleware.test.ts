/**
 * Pins the middleware's public-route list (plan item 2.5).
 *
 * Next.js requires `config.matcher` to be static literals, so the matcher
 * regexes can't be derived from PUBLIC_PREFIXES at runtime. This test is the
 * sync mechanism: it fails if a path's treatment by the runtime check
 * (isPublicPath) disagrees with its treatment by the matcher literals.
 */
import { describe, it, expect, vi } from 'vitest'

// The real `auth` wrapper pulls in the full NextAuth config (env vars,
// providers). The middleware module only needs it to wrap its callback.
vi.mock('@/lib/auth', () => ({
  auth: (handler: unknown) => handler,
}))

import { PUBLIC_PREFIXES, PUBLIC_EXACT, isPublicPath, config } from '@/middleware'

// Next's matcher entries here are plain regex-compatible patterns.
const matcherRegexes = config.matcher.map((m: string) => new RegExp(`^${m}$`))
const middlewareRunsOn = (path: string) =>
  matcherRegexes.some((re) => re.test(path))

// A representative concrete path per public prefix.
const publicPaths = [
  '/api/auth/callback/azure-ad',
  '/auth/signin',
  '/api/health',
  '/api/ops/logs',
  '/api/ingest/v1/tests',
  '/api/stations/v1/config',
]

const protectedPaths = [
  '/',
  '/settings',
  '/stations',
  '/test/123',
  '/api/test-stats',
  '/api/stations', // admin API (session-auth) — only /api/stations/v1/* is public
  '/api/stations/admin-status',
  '/api/annotations/backup',
]

describe('public route list', () => {
  it('every public path passes isPublicPath', () => {
    for (const p of publicPaths) {
      expect(isPublicPath(p), p).toBe(true)
    }
  })

  it('every protected path fails isPublicPath', () => {
    for (const p of protectedPaths) {
      expect(isPublicPath(p), p).toBe(false)
    }
  })

  it('matcher literals agree with isPublicPath for public API paths', () => {
    // Public API paths must be excluded by the matcher (middleware never runs).
    for (const p of publicPaths.filter((p) => p.startsWith('/api/'))) {
      expect(middlewareRunsOn(p), p).toBe(false)
    }
  })

  it('matcher literals agree with isPublicPath for protected paths', () => {
    for (const p of protectedPaths) {
      expect(middlewareRunsOn(p), p).toBe(true)
    }
  })

  it('every declared prefix is exercised by a sample path above', () => {
    for (const prefix of [...PUBLIC_PREFIXES, ...PUBLIC_EXACT]) {
      expect(
        publicPaths.some((p) => p === prefix || p.startsWith(prefix)),
        `no sample path covers ${prefix}`
      ).toBe(true)
    }
  })
})
