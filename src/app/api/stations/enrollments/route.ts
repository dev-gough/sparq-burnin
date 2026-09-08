import { NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { withClient } from '@/lib/stationControls'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stations/enrollments — pending (+ recent decided) enrollment
 * requests for the /stations admin page (station admins only).
 *
 * Candidate secrets are NEVER returned — they stay in the DB until an
 * approval upserts them into StationCredentials.
 */
export async function GET() {
  const { error } = await requireStationAdminAuth()
  if (error) return error

  try {
    const enrollments = await withClient(async (client) => {
      const r = await client.query(
        `SELECT e.id, e.station_id, e.candidate_station_id, e.enrollment_request_id,
                e.token_id, t.label AS token_label, e.fingerprint, e.request_ip,
                e.status, e.requested_at, e.decided_at, e.decided_by
         FROM StationEnrollments e
         LEFT JOIN EnrollmentTokens t ON t.token_id = e.token_id
         WHERE e.status = 'pending'
            OR e.requested_at > NOW() - INTERVAL '7 days'
         ORDER BY (e.status = 'pending') DESC, e.requested_at DESC
         LIMIT 200`
      )
      return r.rows.map((row) => ({
        id: Number(row.id),
        stationId: row.station_id as string,
        candidateStationId: (row.candidate_station_id as string) ?? null,
        enrollmentRequestId: (row.enrollment_request_id as string) ?? null,
        tokenId: (row.token_id as string) ?? null,
        tokenLabel: (row.token_label as string) ?? null,
        fingerprint: (row.fingerprint as Record<string, string>) ?? null,
        requestIp: (row.request_ip as string) ?? null,
        status: row.status as string,
        requestedAt: row.requested_at
          ? new Date(row.requested_at as string).toISOString()
          : null,
        decidedAt: row.decided_at
          ? new Date(row.decided_at as string).toISOString()
          : null,
        decidedBy: (row.decided_by as string) ?? null,
      }))
    })
    return NextResponse.json({ enrollments })
  } catch (err) {
    console.error('list enrollments failed:', err)
    return NextResponse.json(
      { error: 'Failed to list enrollments' },
      { status: 500 }
    )
  }
}
