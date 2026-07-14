import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createCipheriv, randomBytes } from 'crypto'

/**
 * Lightweight app / Next.js-side file logger.
 * Writes JSON lines to logs/app-YYYY-MM-DD.log (optionally AES-GCM encrypted
 * with the same LOG_ENCRYPTION_KEY as email logs).
 */

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs')
const ENCRYPTION_KEY = process.env.LOG_ENCRYPTION_KEY

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
    return 'ENCRYPTION_FAILED'
  }
}

export function getAppLogFilePath(date = new Date()): string {
  const day = date.toISOString().split('T')[0]
  return join(LOG_DIR, `app-${day}.log`)
}

export function logAppEvent(
  context: string,
  data: Record<string, unknown> = {}
): void {
  try {
    ensureDir()
    const entry = {
      timestamp: new Date().toISOString(),
      source: 'app',
      context,
      ...data,
    }
    const line = encryptLine(JSON.stringify(entry)) + '\n'
    appendFileSync(getAppLogFilePath(), line, 'utf-8')
  } catch (err) {
    console.error('appLogger failed:', err)
  }
}
