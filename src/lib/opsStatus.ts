/**
 * Ops status files written by watchdog.py / scripts/ingest.ts
 * and read by GET /api/health for Control Center metrics.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { loadConfig } from './config'

export const WATCHDOG_STATUS_FILE = 'watchdog-status.json'
export const INGEST_STATUS_FILE = 'ingest-status.json'

export interface WatchdogStatus {
  updatedAt: string
  cycleCount?: number
  checkIntervalSec: number
  lastCycleStartedAt?: string
  lastCycleFinishedAt?: string
  /** ISO timestamp when the next cycle is expected to start */
  nextCycleAt?: string
  lastFilesCopied?: number
  lastIngestTriggered?: boolean
  lastIngestSuccess?: boolean | null
  pid?: number
}

export interface IngestStatus {
  updatedAt: string
  startedAt: string
  finishedAt: string
  durationMs: number
  success: boolean
  /** Tests newly ingested this run */
  newTests: number
  /** Total Tests rows in DB after this run (when available) */
  totalTests: number | null
  exactMatches?: number
  closestMatches?: number
  unmatched?: number
  error?: string | null
}

function opsDir(mainDir: string): string {
  return path.join(mainDir, '.ops')
}

export function getOpsDirFromConfig(): string {
  const config = loadConfig()
  return opsDir(config.paths.local.main_dir)
}

export async function writeJsonStatus(
  fileName: string,
  data: unknown
): Promise<void> {
  const dir = getOpsDirFromConfig()
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

export async function readJsonStatus<T>(
  fileName: string
): Promise<T | null> {
  try {
    const dir = getOpsDirFromConfig()
    const raw = await fs.readFile(path.join(dir, fileName), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeIngestStatus(
  status: Omit<IngestStatus, 'updatedAt'>
): Promise<void> {
  await writeJsonStatus(INGEST_STATUS_FILE, {
    ...status,
    updatedAt: new Date().toISOString(),
  } satisfies IngestStatus)
}

/** Seconds until nextCycleAt; null if unknown or past without bound. */
export function secondsUntil(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((t - now) / 1000))
}
