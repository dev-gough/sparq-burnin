import { NextRequest, NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import {
  getStationControl,
  setStationEnabled,
  setStationHidden,
} from '@/lib/stationControls'

type RouteProps = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, props: RouteProps) {
  const { error } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const stationId = decodeURIComponent(id).trim()
  if (!stationId) {
    return NextResponse.json({ error: 'Missing station id' }, { status: 400 })
  }

  try {
    const control = await getStationControl(stationId)
    return NextResponse.json({ station: control })
  } catch (err) {
    console.error('get station failed:', err)
    return NextResponse.json({ error: 'Failed to load station' }, { status: 500 })
  }
}

/**
 * PATCH /api/stations/[id]
 * Body: { enabled?: boolean, reason?: string | null, hidden?: boolean }
 * At least one of enabled or hidden is required. Hidden is UI-only and
 * does not change policy enablement or credentials.
 */
export async function PATCH(request: NextRequest, props: RouteProps) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const stationId = decodeURIComponent(id).trim()
  if (!stationId) {
    return NextResponse.json({ error: 'Missing station id' }, { status: 400 })
  }

  let body: { enabled?: unknown; reason?: unknown; hidden?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const hasEnabled = typeof body.enabled === 'boolean'
  const hasHidden = typeof body.hidden === 'boolean'
  if (!hasEnabled && !hasHidden) {
    return NextResponse.json(
      { error: 'enabled or hidden must be a boolean' },
      { status: 400 }
    )
  }

  const reason =
    body.reason === undefined || body.reason === null
      ? null
      : String(body.reason).slice(0, 500)

  const email =
    session?.user?.email ||
    (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown')

  try {
    let hidden:
      | { stationId: string; hiddenAt: string | null; hiddenBy: string | null }
      | undefined
    if (hasHidden) {
      hidden = await setStationHidden({
        stationId,
        hidden: body.hidden as boolean,
        hiddenBy: email,
      })
      console.log(
        `[station-admin] ${body.hidden ? 'hid' : 'unhid'} station_id=${stationId} by=${email}`
      )
      if (!hasEnabled) {
        return NextResponse.json({ ok: true, ...hidden })
      }
    }

    const station = await setStationEnabled({
      stationId,
      enabled: body.enabled as boolean,
      reason,
      updatedBy: email,
    })
    return NextResponse.json({ station, hidden: hidden ?? null })
  } catch (err) {
    console.error('set station failed:', err)
    return NextResponse.json(
      { error: 'Failed to update station' },
      { status: 500 }
    )
  }
}
