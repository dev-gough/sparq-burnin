import { NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { listStationControls } from '@/lib/stationControls'

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
