import { NextResponse } from 'next/server'
import {
  isOnStationAdminAllowlist,
  requireStationAdminAuth,
} from '@/lib/auth-check'
import { listStationControls } from '@/lib/stationControls'
import { auth } from '@/lib/auth'

/** GET /api/stations — list station control state (station admins only). */
export async function GET() {
  const { error } = await requireStationAdminAuth()
  if (error) return error

  try {
    const stations = await listStationControls()
    return NextResponse.json({ stations })
  } catch (err) {
    console.error('list stations failed:', err)
    return NextResponse.json(
      { error: 'Failed to list stations' },
      { status: 500 }
    )
  }
}

/** Lightweight check for UI: is current user a station admin? */
export async function HEAD() {
  const session = await auth()
  const email = session?.user?.email
  if (!isOnStationAdminAllowlist(email)) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, { status: 204 })
}
