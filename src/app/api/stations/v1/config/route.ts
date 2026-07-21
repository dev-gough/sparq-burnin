import { NextRequest, NextResponse } from 'next/server'
import { verifyIngestRequest } from '@/lib/ingestAuth'
import { getStation } from '@/lib/ingest/stations'
import { getStationControl } from '@/lib/stationControls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stations/v1/config
 * Station machine poll (HMAC). Returns single enabled flag + reason.
 * Auth signs empty body (GET).
 */
export async function GET(request: NextRequest) {
  const stationIdHeader = request.headers.get('x-station-id')?.trim() || ''
  const rawBody = Buffer.alloc(0)

  // Identity only — policy enablement comes from StationControls, not config.json
  const earlyAuth = verifyIngestRequest({
    request,
    rawBody,
    stationIdHeader,
    bodyStationId: undefined,
    getStation: (id) => {
      const s = getStation(id)
      if (!s) return undefined
      return { secret: s.secret, enabled: true }
    },
  })

  if (!earlyAuth.ok) {
    return NextResponse.json(
      { ok: false, code: 'auth', message: `Unauthorized (${earlyAuth.reason})` },
      { status: 401 }
    )
  }

  const stationId = earlyAuth.stationId

  try {
    const control = await getStationControl(stationId)
    const pollAfterSec = Number(process.env.STATION_POLICY_POLL_SEC || 30)

    return NextResponse.json({
      ok: true,
      stationId,
      enabled: control?.enabled ?? true,
      reason: control?.reason ?? null,
      revision: control?.revision ?? 0,
      updatedAt: control?.updatedAt ?? null,
      serverTime: new Date().toISOString(),
      pollAfterSec:
        Number.isFinite(pollAfterSec) && pollAfterSec > 0 ? pollAfterSec : 30,
    })
  } catch (err) {
    console.error('station config poll failed:', err)
    return NextResponse.json(
      { ok: false, code: 'server_error', message: 'Failed to load policy' },
      { status: 500 }
    )
  }
}
