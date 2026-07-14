/**
 * Bundle D — disk + DB capacity for Control Center.
 * Dir sizes are cached (expensive on large processed/ trees).
 */
import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Client } from 'pg'
import { getDatabaseConfig, loadConfig } from './config'

const execFileAsync = promisify(execFile)

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface CapacitySnapshot {
  latencyMs: number
  /** Bytes free (available to non-root) on the volume holding data/ */
  freeBytes: number | null
  totalBytes: number | null
  freeRatio: number | null
  toProcessBytes: number | null
  processedBytes: number | null
  logBytes: number | null
  dbSizeBytes: number | null
  errors: string[]
  /** True when dir sizes came from cache */
  cached?: boolean
}

const DIR_SIZE_CACHE_TTL_MS = 5 * 60_000
const DIR_SIZE_TIMEOUT_MS = 4_000
const DB_TIMEOUT_MS = 600

type DirCacheEntry = { bytes: number; expiresAt: number }
const dirSizeCache = new Map<string, DirCacheEntry>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** Prefer `du -sb` (fast); fall back to a bounded walk. */
async function dirSizeBytes(dir: string): Promise<number | null> {
  const now = Date.now()
  const cached = dirSizeCache.get(dir)
  if (cached && cached.expiresAt > now) {
    return cached.bytes
  }

  try {
    await fs.access(dir)
  } catch {
    return 0
  }

  let bytes: number | null = null

  try {
    const { stdout } = await withTimeout(
      execFileAsync('du', ['-sb', dir], {
        maxBuffer: 1024 * 1024,
      }),
      DIR_SIZE_TIMEOUT_MS
    )
    const first = stdout.trim().split(/\s+/)[0]
    const n = Number(first)
    if (Number.isFinite(n) && n >= 0) bytes = n
  } catch {
    /* try walk */
  }

  if (bytes == null) {
    try {
      bytes = await withTimeout(walkSize(dir, 50_000), DIR_SIZE_TIMEOUT_MS)
    } catch {
      return cached?.bytes ?? null
    }
  }

  dirSizeCache.set(dir, {
    bytes,
    expiresAt: now + DIR_SIZE_CACHE_TTL_MS,
  })
  return bytes
}

/** Bounded recursive size (files only); stops after maxFiles. */
async function walkSize(dir: string, maxFiles: number): Promise<number> {
  let total = 0
  let files = 0
  const stack = [dir]

  while (stack.length > 0 && files < maxFiles) {
    const current = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(current, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
      } else if (ent.isFile()) {
        try {
          const st = await fs.stat(full)
          total += st.size
          files += 1
          if (files >= maxFiles) break
        } catch {
          /* skip */
        }
      }
    }
  }
  return total
}

async function volumeStats(dir: string): Promise<{
  freeBytes: number | null
  totalBytes: number | null
  freeRatio: number | null
}> {
  try {
    // Node 18.15+ / 20+
    const s = await fs.statfs(dir)
    const bsize = Number(s.bsize) || 4096
    const freeBytes = Number(s.bavail) * bsize
    const totalBytes = Number(s.blocks) * bsize
    const freeRatio =
      totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 1000 : null
    return { freeBytes, totalBytes, freeRatio }
  } catch {
    return { freeBytes: null, totalBytes: null, freeRatio: null }
  }
}

async function dbSizeBytes(): Promise<number | null> {
  const client = new Client({
    ...getDatabaseConfig(),
    connectionTimeoutMillis: 500,
  })
  try {
    await withTimeout(client.connect(), 600)
    const result = await withTimeout(
      client.query(`SELECT pg_database_size(current_database())::bigint AS size`),
      DB_TIMEOUT_MS
    )
    const n = result.rows[0]?.size
    if (typeof n === 'string') return Number(n)
    if (typeof n === 'number' || typeof n === 'bigint') return Number(n)
    return null
  } catch {
    return null
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}

export async function snapshotCapacity(): Promise<CapacitySnapshot> {
  const started = Date.now()
  const errors: string[] = []
  let mainDir = ''
  let logDir = ''

  try {
    const config = loadConfig()
    mainDir = config.paths.local.main_dir
    logDir = config.paths.local.log_dir
  } catch (err) {
    return {
      latencyMs: Date.now() - started,
      freeBytes: null,
      totalBytes: null,
      freeRatio: null,
      toProcessBytes: null,
      processedBytes: null,
      logBytes: null,
      dbSizeBytes: null,
      errors: [err instanceof Error ? err.message : 'config unreadable'],
    }
  }

  const toProcess = path.join(mainDir, 'to_process')
  const processed = path.join(mainDir, 'processed')

  const anyCached =
    dirSizeCache.has(toProcess) ||
    dirSizeCache.has(processed) ||
    dirSizeCache.has(logDir)

  const [vol, toProcessBytes, processedBytes, logBytes, dbBytes] =
    await Promise.all([
      volumeStats(mainDir),
      dirSizeBytes(toProcess),
      dirSizeBytes(processed),
      dirSizeBytes(logDir),
      dbSizeBytes(),
    ])

  if (toProcessBytes == null) errors.push('to_process size unavailable')
  if (processedBytes == null) errors.push('processed size unavailable')
  if (dbBytes == null) errors.push('db size unavailable')

  return {
    latencyMs: Date.now() - started,
    freeBytes: vol.freeBytes,
    totalBytes: vol.totalBytes,
    freeRatio: vol.freeRatio,
    toProcessBytes,
    processedBytes,
    logBytes,
    dbSizeBytes: dbBytes,
    errors,
    cached: anyCached,
  }
}

const GiB = 1024 ** 3

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  return `${(n / 1024 ** 4).toFixed(2)} TiB`
}

/**
 * Capacity is about headroom. Prefer free-space signals over absolute used size.
 */
export function capacityStatus(snap: CapacitySnapshot): {
  status: HealthStatus
  detail: string
} {
  if (snap.freeBytes != null) {
    const pct =
      snap.freeRatio != null
        ? `${Math.round(snap.freeRatio * 100)}% free`
        : null

    if (snap.freeBytes < 1 * GiB) {
      return {
        status: 'degraded',
        detail: `only ${formatBytes(snap.freeBytes)} free${pct ? ` (${pct})` : ''}`,
      }
    }
    if (snap.freeBytes < 5 * GiB || (snap.freeRatio != null && snap.freeRatio < 0.05)) {
      return {
        status: 'degraded',
        detail: `${formatBytes(snap.freeBytes)} free${pct ? ` · ${pct}` : ''}`,
      }
    }

    const usedParts: string[] = []
    if (snap.processedBytes != null) {
      usedParts.push(`processed ${formatBytes(snap.processedBytes)}`)
    }
    if (snap.dbSizeBytes != null) {
      usedParts.push(`db ${formatBytes(snap.dbSizeBytes)}`)
    }

    return {
      status: 'ok',
      detail: [
        `${formatBytes(snap.freeBytes)} free`,
        pct,
        ...usedParts.slice(0, 2),
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }

  if (snap.errors.length > 0 && snap.processedBytes == null && snap.dbSizeBytes == null) {
    return {
      status: 'degraded',
      detail: snap.errors[0] || 'capacity unreadable',
    }
  }

  // No free-space info — still report used sizes
  const parts: string[] = []
  if (snap.processedBytes != null) parts.push(`processed ${formatBytes(snap.processedBytes)}`)
  if (snap.dbSizeBytes != null) parts.push(`db ${formatBytes(snap.dbSizeBytes)}`)
  return {
    status: 'ok',
    detail: parts.length > 0 ? parts.join(' · ') : 'capacity partial',
  }
}
