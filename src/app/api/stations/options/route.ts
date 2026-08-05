import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-check'
import { getPool } from '@/lib/db'

/**
 * GET /api/stations/options — station ids available for dashboard chart
 * filtering. Unlike /api/stations (admin-only control state), this is open to
 * any authenticated user and returns names only.
 *
 * The list is stations actually seen in Tests, not config.json ingest keys:
 * a chip that can never match a test row is noise (dev config placeholders),
 * and legacy CSV deployments (prod today — all station_id NULL) get an empty
 * list so the station filter UI hides itself entirely.
 */
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const r = await getPool().query(
      `SELECT DISTINCT station_id
       FROM Tests
       WHERE station_id IS NOT NULL AND station_id <> ''
       ORDER BY station_id`
    )
    const stations = r.rows.map((row) => row.station_id as string)
    return NextResponse.json({ stations })
  } catch (err) {
    console.error('list station options failed:', err)
    return NextResponse.json(
      { error: 'Failed to list stations' },
      { status: 500 }
    )
  }
}
