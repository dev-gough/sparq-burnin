import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ stat: vi.fn(), opendir: vi.fn() }))
vi.mock('fs', () => ({ promises: io }))
vi.mock('@/lib/config', () => ({ loadConfig: () => ({ paths: {
  source_directories: [{ name: 'burnin_sync', results_dir: '/cloud/results', data_dir: '/cloud/data' }],
} }) }))
import { snapshotSources, sourcesStatus } from '@/lib/pipelineOps'

beforeEach(() => {
  vi.resetAllMocks()
  io.stat.mockResolvedValue({ isDirectory: () => true })
})

describe('source directory health', () => {
  it('accepts readable empty directories without treating idle manufacturing as an outage', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    io.opendir.mockImplementation(async () => ({ read: async () => null, close }))
    const snapshot = await snapshotSources()
    expect(snapshot.reachable).toBe(1)
    expect(sourcesStatus(snapshot).status).toBe('ok')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('detects FUSE listing failure despite successful cached metadata', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    io.opendir.mockImplementation(async () => ({
      read: async () => { throw Object.assign(new Error('backend secret must not leak'), { code: 'EIO' }) }, close,
    }))
    const snapshot = await snapshotSources()
    expect(snapshot).toMatchObject({ reachable: 0, sources: [{ resultsError: 'I/O error (EIO)', dataError: 'I/O error (EIO)' }] })
    const health = sourcesStatus(snapshot)
    expect(health.status).toBe('degraded')
    expect(health.detail).toContain('burnin_sync')
    expect(health.detail).toContain('EIO')
    expect(health.detail).toContain('pCloud authorization')
    expect(health.detail).not.toContain('backend secret')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('reports partial reachability when only one directory can be listed', async () => {
    io.opendir.mockImplementation(async (dir: string) => {
      if (dir.endsWith('/data')) throw Object.assign(new Error(), { code: 'EACCES' })
      return { read: async () => null, close: async () => {} }
    })
    const snapshot = await snapshotSources()
    expect(snapshot.sources[0]).toMatchObject({ resultsOk: true, dataOk: false })
    expect(sourcesStatus(snapshot).detail).toContain('permission denied (EACCES)')
  })

  it('bounds the entire metadata and listing operation', async () => {
    vi.useFakeTimers()
    try {
      io.stat.mockImplementation(() => new Promise(() => {}))
      const pending = snapshotSources()
      await vi.advanceTimersByTimeAsync(400)
      const snapshot = await pending
      expect(snapshot.reachable).toBe(0)
      expect(sourcesStatus(snapshot).status).toBe('degraded')
    } finally { vi.useRealTimers() }
  })
})
