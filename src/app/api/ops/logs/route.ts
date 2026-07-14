import {
  getOpsHmacSecret,
  opsUnauthorizedResponse,
  verifyOpsRequest,
} from '@/lib/opsAuth'
import {
  collectOpsLogs,
  parseDaysParam,
  parseSourcesParam,
} from '@/lib/opsLogReader'
import { logAppEvent } from '@/lib/appLogger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ops log export for SPARQ Toolbox Control Center.
 *
 * Auth: HMAC-SHA256 over timestamp + nonce + method + path + query
 * Headers: X-Ops-Timestamp, X-Ops-Nonce, X-Ops-Signature
 *
 * Query:
 *   days=1..14     (default 3)
 *   sources=app,email,files|all
 *
 * Failures intentionally return 404 with empty body.
 */
export async function GET(request: Request) {
  if (!getOpsHmacSecret()) {
    return opsUnauthorizedResponse()
  }

  const auth = verifyOpsRequest(request)
  if (!auth.ok) {
    // Avoid leaking reason to client; log locally for operators
    try {
      logAppEvent('OPS_LOG_AUTH_FAIL', { reason: auth.reason })
    } catch {
      /* ignore */
    }
    return opsUnauthorizedResponse()
  }

  try {
    const url = new URL(request.url)
    const days = parseDaysParam(url.searchParams.get('days'))
    const sources = parseSourcesParam(url.searchParams.get('sources'))

    const payload = await collectOpsLogs({ days, sources })

    try {
      logAppEvent('OPS_LOG_READ', {
        days,
        sources: Array.from(sources),
        fileCount: payload.files.length,
        truncated: payload.truncated,
      })
    } catch {
      /* ignore */
    }

    return Response.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    try {
      logAppEvent('OPS_LOG_ERROR', {
        error: err instanceof Error ? err.message : 'unknown',
      })
    } catch {
      /* ignore */
    }
    // Still 404 externally — do not leak internal errors on ops surface
    return opsUnauthorizedResponse()
  }
}
