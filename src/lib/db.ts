/**
 * Shared, lazily-created module-level pg Pool for the Next.js runtime.
 *
 * Connection config comes from config.json via getDatabaseConfig() (NOT
 * .env.local), matching every other DB consumer in this app.
 *
 * The pool is created on first use, so merely importing a module that
 * references it (e.g. through the src/lib/ingest barrel) never opens a
 * socket. This matters for tsx scripts: they import specific src/lib/ingest
 * modules and keep their own short-lived Clients, and must exit cleanly
 * without a lingering pool keeping the event loop alive.
 */
import { Pool } from 'pg'
import { getDatabaseConfig } from '@/lib/config'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...getDatabaseConfig(),
      max: 10,
      idleTimeoutMillis: 30_000,
    })
    // Idle pooled clients can emit errors (e.g. server restart / network
    // drop); without a handler that would crash the process.
    pool.on('error', (err) => {
      console.error('pg pool idle client error:', err)
    })
  }
  return pool
}
