import {
  getOpsHmacSecret,
  opsUnauthorizedResponse,
  verifyOpsRequest,
} from '@/lib/opsAuth'
import {
  listOpsLogFiles,
  parseDaysParam,
  parseSourcesParam,
  readOpsLogFileRaw,
} from '@/lib/opsLogReader'
import { logAppEvent } from '@/lib/appLogger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Whole-file ops export for SPARQ Toolbox log archive.
 *
 * GET /api/ops/log-files?days=2&sources=app,next,email
 *   → JSON listing { name, source, size, modifiedAt }
 *
 * GET /api/ops/log-files?file=app-2026-08-17.log
 *   → application/octet-stream (ciphertext as stored on disk)
 *
 * Auth: same HMAC as /api/ops/logs. Failures return 404.
 */
export async function GET(request: Request) {
  if (!getOpsHmacSecret()) {
    return opsUnauthorizedResponse()
  }

  const auth = verifyOpsRequest(request)
  if (!auth.ok) {
    try {
      logAppEvent('OPS_LOG_FILE_AUTH_FAIL', { reason: auth.reason })
    } catch {
      /* ignore */
    }
    return opsUnauthorizedResponse()
  }

  try {
    const url = new URL(request.url)
    const fileName = url.searchParams.get('file')?.trim() || ''

    if (fileName) {
      const file = await readOpsLogFileRaw(fileName)
      if (!file) {
        return opsUnauthorizedResponse()
      }

      try {
        logAppEvent('OPS_LOG_FILE_READ', {
          name: file.name,
          size: file.size,
        })
      } catch {
        /* ignore */
      }

      return new Response(new Uint8Array(file.bytes), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/octet-stream',
          'X-Log-Name': file.name,
          'X-Log-Source': file.source,
          'X-Log-Sha256': file.sha256,
          'X-Log-Modified-At': file.modifiedAt,
          'X-Log-Size': String(file.size),
        },
      })
    }

    const days = parseDaysParam(url.searchParams.get('days'))
    const sources = parseSourcesParam(url.searchParams.get('sources'))
    const files = await listOpsLogFiles({ days, sources })

    try {
      logAppEvent('OPS_LOG_FILE_LIST', {
        days,
        sources: Array.from(sources),
        fileCount: files.length,
      })
    } catch {
      /* ignore */
    }

    return Response.json(
      {
        service: 'mfg-datavis',
        fetchedAt: new Date().toISOString(),
        days,
        sources: Array.from(sources),
        files,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (err) {
    try {
      logAppEvent('OPS_LOG_FILE_ERROR', {
        error: err instanceof Error ? err.message : 'unknown',
      })
    } catch {
      /* ignore */
    }
    return opsUnauthorizedResponse()
  }
}
