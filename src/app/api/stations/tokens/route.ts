import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireStationAdminAuth } from '@/lib/auth-check'
import { withClient } from '@/lib/stationControls'

export const dynamic = 'force-dynamic'

interface TokenListRow {
  tokenId: string
  label: string
  createdBy: string
  createdAt: string | null
  expiresAt: string | null
  maxUses: number | null
  uses: number
  revokedAt: string | null
}

function mapTokenRow(row: Record<string, unknown>): TokenListRow {
  return {
    tokenId: row.token_id as string,
    label: row.label as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at
      ? new Date(row.created_at as string).toISOString()
      : null,
    expiresAt: row.expires_at
      ? new Date(row.expires_at as string).toISOString()
      : null,
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    uses: Number(row.uses) || 0,
    revokedAt: row.revoked_at
      ? new Date(row.revoked_at as string).toISOString()
      : null,
  }
}

/**
 * GET /api/stations/tokens — list bootstrap tokens (station admins only).
 * NEVER returns token secrets: the full `<id>.<secret>` is shown exactly once,
 * in the mint (POST) response.
 */
export async function GET() {
  const { error } = await requireStationAdminAuth()
  if (error) return error

  try {
    const tokens = await withClient(async (client) => {
      const r = await client.query(
        `SELECT token_id, label, created_by, created_at, expires_at,
                max_uses, uses, revoked_at
         FROM EnrollmentTokens
         ORDER BY created_at DESC`
      )
      return r.rows.map(mapTokenRow)
    })
    return NextResponse.json({ tokens })
  } catch (err) {
    console.error('list enrollment tokens failed:', err)
    return NextResponse.json({ error: 'Failed to list tokens' }, { status: 500 })
  }
}

/**
 * POST /api/stations/tokens — mint a bootstrap token (station admins only).
 * Body: { label: string, expiresInDays: number, maxUses?: number | null }
 *
 * Response includes the full `<token_id>.<token_secret>` ONCE, for the build
 * script; only metadata is retrievable afterwards.
 */
export async function POST(request: NextRequest) {
  const { error, session } = await requireStationAdminAuth()
  if (error) return error

  let body: { label?: unknown; expiresInDays?: unknown; maxUses?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 200) {
    return NextResponse.json(
      { error: 'label is required (max 200 chars)' },
      { status: 400 }
    )
  }

  const expiresInDays = Number(body.expiresInDays)
  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650) {
    return NextResponse.json(
      { error: 'expiresInDays must be a positive number of days (max 3650)' },
      { status: 400 }
    )
  }

  let maxUses: number | null = null
  if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== '') {
    maxUses = Number(body.maxUses)
    if (!Number.isInteger(maxUses) || maxUses <= 0) {
      return NextResponse.json(
        { error: 'maxUses must be a positive integer (or omitted)' },
        { status: 400 }
      )
    }
  }

  const email =
    session?.user?.email ||
    (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown')

  // token_id: short random public half (loggable, baked into the exe next to
  // the secret); token_secret: 32-byte hex HMAC key, stored plaintext by
  // necessity (revocation/expiry is the control).
  const tokenId = randomBytes(6).toString('hex')
  const tokenSecret = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  try {
    const token = await withClient(async (client) => {
      const r = await client.query(
        `INSERT INTO EnrollmentTokens
           (token_id, token_secret, label, created_by, expires_at, max_uses)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING token_id, label, created_by, created_at, expires_at,
                   max_uses, uses, revoked_at`,
        [tokenId, tokenSecret, label, email, expiresAt.toISOString(), maxUses]
      )
      return mapTokenRow(r.rows[0])
    })

    console.log(`[enroll-admin] minted token_id=${tokenId} label=${JSON.stringify(label)} by=${email}`)
    return NextResponse.json(
      {
        ok: true,
        token,
        // One-time full token for the station build script — never shown again.
        bootstrapToken: `${tokenId}.${tokenSecret}`,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('mint enrollment token failed:', err)
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 })
  }
}
