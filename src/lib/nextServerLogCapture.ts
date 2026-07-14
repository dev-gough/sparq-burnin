/**
 * Capture real Next.js / Node process stdout + stderr into
 * logs/next-YYYY-MM-DD.log so Control Center ops log export can serve them.
 *
 * Lines are JSON (optionally AES-GCM encrypted with LOG_ENCRYPTION_KEY, same
 * as app/email logs). Install once from instrumentation (Node runtime only).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { createCipheriv, randomBytes } from 'crypto'

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs')
const ENCRYPTION_KEY = process.env.LOG_ENCRYPTION_KEY
const MAX_NEXT_LOG_FILES = 14
const MAX_LINE_CHARS = 16_000

let installed = false

type StreamName = 'stdout' | 'stderr'

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function encryptLine(data: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    return data
  }
  try {
    const iv = randomBytes(16)
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag()
    return `${encrypted}:${iv.toString('hex')}:${authTag.toString('hex')}`
  } catch {
    return data // fall back to plaintext rather than drop the line
  }
}

function getNextLogFilePath(date = new Date()): string {
  const day = date.toISOString().split('T')[0]
  return join(LOG_DIR, `next-${day}.log`)
}

function pruneOldNextLogs() {
  try {
    ensureDir()
    const files = readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('next-') && f.endsWith('.log'))
      .map((name) => ({
        name,
        path: join(LOG_DIR, name),
        time: statSync(join(LOG_DIR, name)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time)

    for (const f of files.slice(MAX_NEXT_LOG_FILES)) {
      try {
        unlinkSync(f.path)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Infer a useful context tag from Next/Node log text for filtering in CC. */
export function classifyNextLogLine(
  stream: StreamName,
  text: string
): string {
  const t = text.trim()
  if (!t) return stream === 'stderr' ? 'STDERR' : 'STDOUT'

  if (stream === 'stderr') {
    if (/error|exception|failed|EADDRINUSE|ENOENT/i.test(t)) return 'NEXT_ERROR'
    if (/warn/i.test(t)) return 'NEXT_WARN'
    return 'STDERR'
  }

  // stdout patterns from next dev / next start
  if (/^✓\s*Ready/i.test(t) || /Ready in /i.test(t)) return 'NEXT_READY'
  if (/Starting\.\.\.|started server/i.test(t)) return 'NEXT_START'
  if (/Compiling|compiled/i.test(t)) return 'NEXT_COMPILE'
  if (/▲\s*Next\.js/i.test(t)) return 'NEXT_BANNER'
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i.test(t)) {
    return 'NEXT_REQUEST'
  }
  if (/\s(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(t) && /\d{3}\s+in\s+/i.test(t)) {
    return 'NEXT_REQUEST'
  }
  if (/error|failed|exception/i.test(t)) return 'NEXT_ERROR'
  if (/warn/i.test(t)) return 'NEXT_WARN'
  if (/Fast Refresh|hot reloaded|HMR/i.test(t)) return 'NEXT_HMR'
  if (/Environments:|Local:|Network:/i.test(t)) return 'NEXT_INFO'

  return 'STDOUT'
}

function writeNextLogLine(stream: StreamName, text: string) {
  const cleaned = text.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
  if (!cleaned) return

  // Avoid capturing our own internal noise if any path re-enters
  if (cleaned.includes('[nextServerLogCapture]')) return

  const message =
    cleaned.length > MAX_LINE_CHARS
      ? cleaned.slice(0, MAX_LINE_CHARS) + '…[truncated]'
      : cleaned

  const entry = {
    timestamp: new Date().toISOString(),
    source: 'next',
    context: classifyNextLogLine(stream, message),
    stream,
    message,
  }

  try {
    ensureDir()
    const line = encryptLine(JSON.stringify(entry)) + '\n'
    appendFileSync(getNextLogFilePath(), line, 'utf-8')
  } catch {
    // Never throw from a write hook — would break the process logger
  }
}

function makeLineBuffer(stream: StreamName) {
  let buf = ''
  return (chunk: string) => {
    buf += chunk
    // Normalize CRLF
    buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (line.length) writeNextLogLine(stream, line)
    }
    // Flush very long unterminated chunks so we don't grow forever
    if (buf.length > MAX_LINE_CHARS) {
      writeNextLogLine(stream, buf)
      buf = ''
    }
  }
}

/**
 * Install stdout/stderr capture. Idempotent.
 * Call from instrumentation register() in the Node runtime only.
 */
export function installNextServerLogCapture(): void {
  if (installed) return
  if (typeof process === 'undefined' || !process.stdout?.write) return

  // Opt-out for tests / special hosts
  if (process.env.NEXT_SERVER_LOG_CAPTURE === 'false') return

  installed = true
  pruneOldNextLogs()

  const onStdout = makeLineBuffer('stdout')
  const onStderr = makeLineBuffer('stderr')

  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
    try {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : String(chunk)
      onStdout(text)
    } catch {
      /* ignore capture errors */
    }
    return origStdout(chunk, encoding, cb)
  }) as typeof process.stdout.write

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((chunk: any, encoding?: any, cb?: any) => {
    try {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : String(chunk)
      onStderr(text)
    } catch {
      /* ignore capture errors */
    }
    return origStderr(chunk, encoding, cb)
  }) as typeof process.stderr.write

  writeNextLogLine(
    'stdout',
    `[nextServerLogCapture] capturing Next.js server logs → ${getNextLogFilePath()}`
  )
}

export function getNextServerLogPath(): string {
  return getNextLogFilePath()
}
