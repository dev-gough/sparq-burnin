import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ stat: vi.fn(), opendir: vi.fn(), readdir: vi.fn(), readFile: vi.fn() }))
vi.mock('fs', () => ({ promises: io }))
vi.mock('@/lib/config', () => ({ loadConfig: () => ({ paths: {
  local: { main_dir: '/local' },
  source_directories: [{ name: 'burnin_sync', results_dir: '/cloud/results', data_dir: '/cloud/data' }],
} }) }))
import { snapshotLock, snapshotQueue, snapshotSources, sourcesStatus } from '@/lib/pipelineOps'

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

  it('does not expose arbitrary backend text for failures without an errno', async () => {
    io.opendir.mockRejectedValue(new Error('backend secret must not leak'))
    const snapshot = await snapshotSources()
    expect(snapshot.sources[0].resultsError).toBe('directory read timed out or failed')
    expect(sourcesStatus(snapshot).detail).not.toContain('backend secret')
    expect(sourcesStatus(snapshot).detail).not.toContain('exceeded 2500ms')
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

  it('accepts a cloud directory listing that exceeds 400ms but finishes within the source limit', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn().mockResolvedValue(undefined)
      io.opendir.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({
          read: () => new Promise(resolve => setTimeout(() => resolve(null), 100)),
          close,
        }), 500)
      }))
      let settled = false
      const pending = snapshotSources().then(snapshot => { settled = true; return snapshot })
      await vi.advanceTimersByTimeAsync(400)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      const snapshot = await pending
      expect(snapshot.reachable).toBe(1)
      expect(sourcesStatus(snapshot).status).toBe('ok')
      expect(snapshot.missing).toEqual([])
      expect(close).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('keeps queue listings and lock-file reads bounded at 400ms', async () => {
    vi.useFakeTimers()
    try {
      const never = () => new Promise<never>(() => {})
      io.readdir.mockImplementation(never)
      io.readFile.mockImplementation(never)
      let settled = false
      const pending = Promise.all([snapshotQueue(), snapshotLock()])
        .then(snapshots => { settled = true; return snapshots })
      await vi.advanceTimersByTimeAsync(399)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const [queue, lock] = await pending
      expect(queue).toMatchObject({ resultsCount: 0, testsCount: 0 })
      expect(lock.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each(['stat', 'opendir', 'read'])('bounds a source check whose %s never finishes', async (stage) => {
    vi.useFakeTimers()
    try {
      const never = () => new Promise<never>(() => {})
      io.opendir.mockResolvedValue({ read: async () => null, close: async () => {} })
      if (stage === 'stat') io.stat.mockImplementation(never)
      if (stage === 'opendir') io.opendir.mockImplementation(never)
      if (stage === 'read') io.opendir.mockResolvedValue({ read: never, close: async () => {} })
      let settled = false
      const pending = snapshotSources().then(snapshot => { settled = true; return snapshot })
      await vi.advanceTimersByTimeAsync(2499)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const snapshot = await pending
      expect(snapshot.reachable).toBe(0)
      expect(snapshot.sources[0]).toMatchObject({
        resultsOk: false, dataOk: false,
        resultsError: 'directory read exceeded 2500ms',
        dataError: 'directory read exceeded 2500ms',
      })
      expect(sourcesStatus(snapshot).status).toBe('degraded')
      expect(sourcesStatus(snapshot).detail).toContain('directory read exceeded 2500ms')
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
