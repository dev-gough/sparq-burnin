import { NextRequest, NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { withClient } from '@/lib/stationControls'

export const dynamic = 'force-dynamic'

type RouteProps = { params: Promise<{ id: string }> }

/**
 * POST /api/stations/enrollments/[id]
 * Body: { action: "approve" | "reject" } (station admins only).
 *
 * Approve upserts the pending row's candidate secret into StationCredentials
 * and marks the row approved; the station's next 202-poll retry then hits the
 * enroll idempotency rule (active credential, same secret) and gets its 201.
 */
export async function POST(request: NextRequest, props: RouteProps) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const enrollmentId = Number(id)
  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return NextResponse.json({ error: 'Invalid enrollment id' }, { status: 400 })
  }

  let body: { action?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 }
    )
  }

  const email =
    session?.user?.email ||
    (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown')

  try {
    const result = await withClient(async (client) => {
      try {
        await client.query('BEGIN')
        // Lock the pending row so two admins cannot decide it twice.
        const r = await client.query(
          `SELECT id, station_id, secret, token_id, fingerprint, request_ip,
                  candidate_station_id, enrollment_request_id
           FROM StationEnrollments
           WHERE id = $1 AND status = 'pending'
           FOR UPDATE`,
          [enrollmentId]
        )
        if (r.rows.length === 0) {
          await client.query('ROLLBACK')
          return { notFound: true as const }
        }
        const row = r.rows[0]

        if (action === 'approve') {
          await client.query(
            `INSERT INTO StationCredentials
               (station_id, secret, token_id, fingerprint, enrolled_ip,
                candidate_station_id, enrollment_request_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (station_id) DO UPDATE SET
               secret = EXCLUDED.secret,
               token_id = EXCLUDED.token_id,
               fingerprint = EXCLUDED.fingerprint,
               enrolled_ip = EXCLUDED.enrolled_ip,
               candidate_station_id = COALESCE(
                 EXCLUDED.candidate_station_id,
                 StationCredentials.candidate_station_id
               ),
               enrollment_request_id = COALESCE(
                 EXCLUDED.enrollment_request_id,
                 StationCredentials.enrollment_request_id
               ),
               updated_at = NOW(),
               revoked_at = NULL`,
            [
              row.station_id,
              row.secret,
              row.token_id,
              row.fingerprint == null ? null : JSON.stringify(row.fingerprint),
              row.request_ip,
              row.candidate_station_id ?? row.station_id,
              row.enrollment_request_id ?? null,
            ]
          )
        }

        await client.query(
          `UPDATE StationEnrollments
           SET status = $2, decided_at = NOW(), decided_by = $3
           WHERE id = $1`,
          [enrollmentId, action === 'approve' ? 'approved' : 'rejected', email]
        )
        await client.query('COMMIT')
        return {
          notFound: false as const,
          stationId: row.station_id as string,
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      }
    })

    if (result.notFound) {
      return NextResponse.json(
        { error: 'No pending enrollment with that id' },
        { status: 404 }
      )
    }

    console.log(
      `[enroll-admin] enrollment=${enrollmentId} station_id=${result.stationId} action=${action} by=${email}`
    )
    return NextResponse.json({
      ok: true,
      id: enrollmentId,
      stationId: result.stationId,
      status: action === 'approve' ? 'approved' : 'rejected',
    })
  } catch (err) {
    console.error('decide enrollment failed:', err)
    return NextResponse.json(
      { error: 'Failed to update enrollment' },
      { status: 500 }
    )
  }
}
