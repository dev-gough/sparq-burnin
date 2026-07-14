import { promises as fs } from 'fs'
import path from 'path'
import { createDecipheriv } from 'crypto'

export type LogSourceId = 'app' | 'email' | 'next' | 'files'

export interface LogFilePayload {
  name: string
  path: string
  source: LogSourceId
  modifiedAt: string
  lineCount: number
  /** Decrypted / plaintext lines, oldest → newest within the file slice. */
  lines: string[]
}

export interface CollectedLogs {
  service: string
  fetchedAt: string
  days: number
  sources: LogSourceId[]
  files: LogFilePayload[]
  truncated: boolean
  notes: string[]
}

const DEFAULT_DAYS = 3
const MAX_DAYS = 14
/** Soft cap so a runaway file cannot blow the response. */
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 // 4 MiB
const MAX_LINES_PER_FILE = 20_000

function logDir(): string {
  // Prefer explicit LOG_DIR; burnin also uses ./log from config.paths.local
  return process.env.LOG_DIR || path.join(process.cwd(), 'logs')
}

function encryptionKey(): string | undefined {
  const k = process.env.LOG_ENCRYPTION_KEY?.trim()
  if (k && k.length === 64) return k
  return undefined
}

/** Decrypt a single line if it looks like ciphertext:iv:tag; else return as-is. */
export function decryptLogLine(line: string, keyHex?: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''
  if (!keyHex) return trimmed

  const parts = trimmed.split(':')
  if (parts.length !== 3) return trimmed

  try {
    const [encrypted, ivHex, authTagHex] = parts
    const key = Buffer.from(keyHex, 'hex')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (err) {
    return `[DECRYPTION_FAILED: ${err instanceof Error ? err.message : 'error'}]`
  }
}

function dayStrings(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d.toISOString().split('T')[0])
  }
  return out
}

function classifyFile(name: string): LogSourceId | null {
  if (name.startsWith('send-email-') && name.endsWith('.log')) return 'email'
  // Dated capture files only (avoid matching next-dev.log etc.)
  if (/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) return 'app'
  if (/^next-\d{4}-\d{2}-\d{2}\.log$/.test(name)) return 'next'
  if (name.endsWith('.log') || name.endsWith('.txt')) return 'files'
  return null
}

async function listCandidateFiles(
  days: number,
  sources: Set<LogSourceId>
): Promise<{ abs: string; name: string; source: LogSourceId; mtime: Date }[]> {
  const dir = logDir()
  const daysSet = new Set(dayStrings(days))
  const results: { abs: string; name: string; source: LogSourceId; mtime: Date }[] = []

  // Primary log dir + burnin legacy ./log + nested layouts
  const dirs = [
    dir,
    path.join(process.cwd(), 'log'),
    path.join(dir, 'logs'),
  ]
  // Optional extra dirs (colon-separated)
  const extra = process.env.OPS_EXTRA_LOG_DIRS?.split(':').map((s) => s.trim()).filter(Boolean) ?? []
  for (const d of extra) dirs.push(d)

  for (const d of dirs) {
    let entries: string[]
    try {
      entries = await fs.readdir(d)
    } catch {
      continue
    }
    for (const name of entries) {
      const source = classifyFile(name)
      if (!source || !sources.has(source)) continue

      // For dated app/email/next logs, filter by day window
      if (source === 'app' || source === 'email' || source === 'next') {
        const m = name.match(/(\d{4}-\d{2}-\d{2})\.log$/)
        if (m && !daysSet.has(m[1])) continue
      }

      const abs = path.join(d, name)
      try {
        const st = await fs.stat(abs)
        if (!st.isFile()) continue
        // For generic files, include if mtime within window
        if (source === 'files') {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
          if (st.mtimeMs < cutoff) continue
        }
        results.push({ abs, name, source, mtime: st.mtime })
      } catch {
        // skip
      }
    }
  }

  // Newest first
  results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  return results
}

async function readFileLines(
  abs: string,
  keyHex: string | undefined,
  budget: { bytesLeft: number }
): Promise<{ lines: string[]; truncated: boolean; bytesRead: number }> {
  if (budget.bytesLeft <= 0) {
    return { lines: [], truncated: true, bytesRead: 0 }
  }

  const raw = await fs.readFile(abs, 'utf-8')
  const slice =
    raw.length > budget.bytesLeft ? raw.slice(raw.length - budget.bytesLeft) : raw
  const truncatedFile = raw.length > budget.bytesLeft

  let lines = slice.split('\n')
  // If we sliced mid-line, drop first partial
  if (truncatedFile && lines.length > 0) {
    lines = lines.slice(1)
  }
  // Drop trailing empty
  if (lines.length && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1)
  }

  if (lines.length > MAX_LINES_PER_FILE) {
    lines = lines.slice(lines.length - MAX_LINES_PER_FILE)
  }

  const decrypted = lines.map((l) => decryptLogLine(l, keyHex)).filter((l) => l.length > 0)
  return {
    lines: decrypted,
    truncated: truncatedFile,
    bytesRead: Buffer.byteLength(slice, 'utf-8'),
  }
}

export function parseDaysParam(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_DAYS
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.floor(n))
}

export function parseSourcesParam(raw: string | null): Set<LogSourceId> {
  const all: LogSourceId[] = ['app', 'email', 'next', 'files']
  if (!raw || raw.trim() === '' || raw.trim() === 'all') {
    return new Set(all)
  }
  const set = new Set<LogSourceId>()
  for (const part of raw.split(',')) {
    const p = part.trim() as LogSourceId
    if (all.includes(p)) set.add(p)
  }
  return set.size ? set : new Set(all)
}

export async function collectOpsLogs(opts: {
  days: number
  sources: Set<LogSourceId>
}): Promise<CollectedLogs> {
  const keyHex = encryptionKey()
  const notes: string[] = []
  if (!keyHex) {
    notes.push('LOG_ENCRYPTION_KEY missing — encrypted lines returned undecrypted')
  }

  const candidates = await listCandidateFiles(opts.days, opts.sources)
  if (candidates.length === 0) {
    notes.push(`No log files found under ${logDir()} for the last ${opts.days} day(s)`)
  }

  const files: LogFilePayload[] = []
  let bytesLeft = MAX_TOTAL_BYTES
  let truncated = false

  for (const c of candidates) {
    if (bytesLeft <= 0) {
      truncated = true
      break
    }
    try {
      const { lines, truncated: t, bytesRead } = await readFileLines(c.abs, keyHex, {
        bytesLeft,
      })
      bytesLeft -= bytesRead
      if (t) truncated = true
      files.push({
        name: c.name,
        path: c.abs,
        source: c.source,
        modifiedAt: c.mtime.toISOString(),
        lineCount: lines.length,
        lines,
      })
    } catch (err) {
      notes.push(
        `Failed to read ${c.name}: ${err instanceof Error ? err.message : 'error'}`
      )
    }
  }

  return {
    service: 'mfg-datavis',
    fetchedAt: new Date().toISOString(),
    days: opts.days,
    sources: Array.from(opts.sources),
    files,
    truncated,
    notes,
  }
}
