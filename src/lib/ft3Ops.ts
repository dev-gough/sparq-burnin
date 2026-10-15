/**
 * FT3 pipeline health: files the strict parser rejected (quarantine/ft3) and
 * files waiting in the queue (to_process/ft3). Filesystem-only.
 *
 * Quarantined files stay "degraded" until someone updates the parser and runs
 * `npm run ingest:ft3 -- --retry-quarantine`, so a format change never sits
 * unnoticed.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { loadConfig } from './config'
import type { HealthStatus } from './pipelineOps'

export const FT3_REASON_SUFFIX = '.reason.txt'

export interface Ft3QuarantinedFile { name: string; quarantinedAt: string; problems: string[] }
export interface Ft3Snapshot {
  configuredFolders: number
  quarantined: number
  /** Newest first, capped. */
  files: Ft3QuarantinedFile[]
  queued: number
  oldestQueuedAgeSec: number | null
  error?: string
}

async function listCsv(dir: string): Promise<{ name: string; mtimeMs: number }[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const files = await Promise.all(names
    .filter((n) => n.toLowerCase().endsWith('.csv'))
    .map(async (name) => ({ name, mtimeMs: (await fs.stat(path.join(dir, name))).mtimeMs })))
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function snapshotFt3(limit = 50, now = Date.now()): Promise<Ft3Snapshot> {
  let configuredFolders = 0
  try {
    const config = loadConfig()
    configuredFolders = config.paths.ft3_directories?.length ?? 0
    const mainDir = config.paths.local.main_dir
    const quarantineDir = path.join(mainDir, 'quarantine', 'ft3')
    const [quarantined, queued] = await Promise.all([
      listCsv(quarantineDir),
      listCsv(path.join(mainDir, 'to_process', 'ft3')),
    ])
    const files = await Promise.all(quarantined.slice(0, limit).map(async (f) => {
      const reason = await fs.readFile(path.join(quarantineDir, `${f.name}${FT3_REASON_SUFFIX}`), 'utf8').catch(() => '')
      const problems = reason.split('\n').map((l) => l.trim()).filter(Boolean)
      return {
        name: f.name,
        quarantinedAt: new Date(f.mtimeMs).toISOString(),
        problems: problems.length ? problems : ['No reason recorded'],
      }
    }))
    const oldest = queued.length ? Math.min(...queued.map((f) => f.mtimeMs)) : null
    return {
      configuredFolders,
      quarantined: quarantined.length,
      files,
      queued: queued.length,
      oldestQueuedAgeSec: oldest == null ? null : Math.max(0, Math.round((now - oldest) / 1000)),
    }
  } catch (err) {
    return {
      configuredFolders, quarantined: 0, files: [], queued: 0, oldestQueuedAgeSec: null,
      error: err instanceof Error ? err.message : 'FT3 folders unreadable',
    }
  }
}

export function ft3Status(s: Ft3Snapshot, checkIntervalSec: number): { status: HealthStatus; detail: string } {
  if (s.error) return { status: 'degraded', detail: `FT3 folders unreadable: ${s.error}` }
  if (s.quarantined > 0) {
    const first = s.files[0]
    return {
      status: 'degraded',
      detail: `${s.quarantined} FT3 ${s.quarantined === 1 ? 'file' : 'files'} could not be parsed; see quarantine/ft3` +
        (first ? ` (newest ${first.name}: ${first.problems[0]})` : ''),
    }
  }
  if (s.oldestQueuedAgeSec != null && s.oldestQueuedAgeSec > checkIntervalSec * 2 + 300) {
    return { status: 'degraded', detail: `${s.queued} FT3 files waiting in to_process/ft3 for over ${Math.round(s.oldestQueuedAgeSec / 60)} min` }
  }
  if (!s.configuredFolders) return { status: 'ok', detail: 'no FT3 folders configured' }
  return { status: 'ok', detail: `${s.configuredFolders} FT3 ${s.configuredFolders === 1 ? 'folder' : 'folders'} · ${s.queued} queued · none quarantined` }
}
