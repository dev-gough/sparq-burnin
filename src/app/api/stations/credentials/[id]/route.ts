import { NextRequest, NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { withClient } from '@/lib/stationControls'

export const dynamic = 'force-dynamic'

type RouteProps = { params: Promise<{ id: string }> }

/**
 * DELETE /api/stations/credentials/[id] — soft-revoke a station credential
 * (id = station_id). Compromise response: the auth resolver skips revoked
 * rows immediately, so the station loses ingest/policy access on its next
 * request. Replaces today's "edit config.json" for enrolled stations.
 */
export async function DELETE(_request: NextRequest, props: RouteProps) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const stationId = decodeURIComponent(id).trim()
  if (!stationId) {
    return NextResponse.json({ error: 'Missing station id' }, { status: 400 })
  }

  const email =
    session?.user?.email ||
    (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown')

  try {
    const revoked = await withClient(async (client) => {
      const r = await client.query(
        `UPDATE StationCredentials
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE station_id = $1 AND revoked_at IS NULL
         RETURNING station_id`,
        [stationId]
      )
      return r.rows.length > 0
    })
    if (!revoked) {
      return NextResponse.json(
        { error: 'Credential not found or already revoked' },
        { status: 404 }
      )
    }
    console.log(`[enroll-admin] revoked credential station_id=${stationId} by=${email}`)
    return NextResponse.json({ ok: true, stationId })
  } catch (err) {
    console.error('revoke station credential failed:', err)
    return NextResponse.json(
      { error: 'Failed to revoke credential' },
      { status: 500 }
    )
  }
}
