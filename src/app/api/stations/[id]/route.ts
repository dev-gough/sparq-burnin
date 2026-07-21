import { NextRequest, NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import {
  getStationControl,
  setStationEnabled,
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
 * Body: { enabled: boolean, reason?: string | null }
 */
export async function PATCH(request: NextRequest, props: RouteProps) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const stationId = decodeURIComponent(id).trim()
  if (!stationId) {
    return NextResponse.json({ error: 'Missing station id' }, { status: 400 })
  }

  let body: { enabled?: unknown; reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be a boolean' },
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
    const station = await setStationEnabled({
      stationId,
      enabled: body.enabled,
      reason,
      updatedBy: email,
    })
    return NextResponse.json({ station })
  } catch (err) {
    console.error('set station failed:', err)
    return NextResponse.json(
      { error: 'Failed to update station' },
      { status: 500 }
    )
  }
}
