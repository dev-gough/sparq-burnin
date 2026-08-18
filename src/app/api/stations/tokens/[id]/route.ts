import { NextRequest, NextResponse } from 'next/server'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { withClient } from '@/lib/stationControls'

export const dynamic = 'force-dynamic'

type RouteProps = { params: Promise<{ id: string }> }

/** DELETE /api/stations/tokens/[id] — revoke a bootstrap token (soft). */
export async function DELETE(_request: NextRequest, props: RouteProps) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  const { id } = await props.params
  const tokenId = decodeURIComponent(id).trim()
  if (!tokenId) {
    return NextResponse.json({ error: 'Missing token id' }, { status: 400 })
  }

  const email =
    session?.user?.email ||
    (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown')

  try {
    const revoked = await withClient(async (client) => {
      const r = await client.query(
        `UPDATE EnrollmentTokens
         SET revoked_at = NOW()
         WHERE token_id = $1 AND revoked_at IS NULL
         RETURNING token_id`,
        [tokenId]
      )
      return r.rows.length > 0
    })
    if (!revoked) {
      return NextResponse.json(
        { error: 'Token not found or already revoked' },
        { status: 404 }
      )
    }
    console.log(`[enroll-admin] revoked token_id=${tokenId} by=${email}`)
    return NextResponse.json({ ok: true, tokenId })
  } catch (err) {
    console.error('revoke enrollment token failed:', err)
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 })
  }
}
