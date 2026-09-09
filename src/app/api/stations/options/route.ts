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
 * list so the station filter UI hides itself entirely. Stations hidden in
 * /stations (StationHidden) are omitted; their tests still count in "all".
 */
export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  try {
    const r = await getPool().query(
      `SELECT DISTINCT t.station_id
       FROM Tests t
       WHERE t.station_id IS NOT NULL AND t.station_id <> ''
         AND NOT EXISTS (
           SELECT 1 FROM StationHidden h WHERE h.station_id = t.station_id
         )
       ORDER BY t.station_id`
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
