import { z } from 'zod'
import { allocateStationId } from '@/lib/allocateStationId'
import { withClient } from '@/lib/stationControls'

/** Max times a unique-index collision retries the whole managed transaction. */
const MAX_TXN_RETRIES = 3
const MAX_ALLOCATE_ATTEMPTS = 8

export const enrollmentRequestIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

export const enrollBodySchema = z
  .object({
    stationId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    enrollmentRequestId: enrollmentRequestIdSchema.optional(),
    secret: z.string().regex(/^[0-9a-f]{64}$/),
    fingerprint: z
      .object({
        hostname: z.string().optional(),
        machineId: z.string().optional(),
        os: z.string().optional(),
        appVersion: z.string().optional(),
      })
      .optional(),
  })
  .strict()

export type EnrollBody = z.infer<typeof enrollBodySchema>

export interface EnrollmentTokenRow {
  token_secret: string
  expires_at: string | Date
  max_uses: number | null
  uses: number
  revoked_at: string | Date | null
}

export type EnrollDecision =
  | {
      kind: 'ok'
      http: 201 | 202
      status: 'active' | 'pending'
      stationId: string
      candidateStationId: string
      enrollmentRequestId: string | null
      outcome: string
    }
  | {
      kind: 'auth'
      outcome: string
    }
  | {
      kind: 'reject'
      error: 'enrollment_rejected' | 'enrollment_conflict'
      outcome: string
    }

interface PgQueryResult {
  rows: Record<string, unknown>[]
}

interface PgClient {
  query: (sql: string, params?: unknown[]) => Promise<PgQueryResult>
}

interface EnrollParams {
  tokenId: string
  token: EnrollmentTokenRow
  body: EnrollBody
  ip: string | null
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
  )
}

export function tokenLifecycleOutcome(
  token: EnrollmentTokenRow
): string | null {
  if (token.revoked_at != null) return 'auth_token_revoked'
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return 'auth_token_expired'
  }
  const maxUses = token.max_uses == null ? null : Number(token.max_uses)
  const uses = Number(token.uses)
  if (maxUses != null && uses >= maxUses) return 'auth_token_uses_exhausted'
  return null
}

function fingerprintJson(body: EnrollBody): string | null {
  return body.fingerprint ? JSON.stringify(body.fingerprint) : null
}

interface EnrollmentAuditRow {
  station_id: string
  candidate_station_id: string | null
  enrollment_request_id: string | null
  secret: string
  status: string
  token_id: string | null
}

function asAuditRow(row: Record<string, unknown>): EnrollmentAuditRow {
  return {
    station_id: String(row.station_id),
    candidate_station_id:
      row.candidate_station_id == null
        ? null
        : String(row.candidate_station_id),
    enrollment_request_id:
      row.enrollment_request_id == null
        ? null
        : String(row.enrollment_request_id),
    secret: String(row.secret),
    status: String(row.status),
    token_id: row.token_id == null ? null : String(row.token_id),
  }
}

async function loadEnrollmentByRequest(
  client: PgClient,
  tokenId: string,
  requestId: string
): Promise<EnrollmentAuditRow | undefined> {
  const r = await client.query(
    `SELECT station_id, candidate_station_id, enrollment_request_id, secret, status, token_id
     FROM StationEnrollments
     WHERE token_id = $1 AND enrollment_request_id = $2
     FOR UPDATE`,
    [tokenId, requestId]
  )
  const row = r.rows[0]
  return row ? asAuditRow(row) : undefined
}

async function replayManaged(
  client: PgClient,
  row: EnrollmentAuditRow,
  body: EnrollBody
): Promise<EnrollDecision> {
  const assigned = row.station_id
  const candidate = row.candidate_station_id || assigned
  const requestId = row.enrollment_request_id
  const allowedIds = new Set([assigned, candidate])
  if (row.secret !== body.secret || !allowedIds.has(body.stationId)) {
    return {
      kind: 'reject',
      error: 'enrollment_conflict',
      outcome: 'managed_request_conflict',
    }
  }
  if (row.status === 'rejected') {
    return {
      kind: 'reject',
      error: 'enrollment_rejected',
      outcome: 'managed_rejected',
    }
  }

  const ok = (
    http: 201 | 202,
    status: 'active' | 'pending',
    outcome: string
  ): EnrollDecision => ({
    kind: 'ok',
    http,
    status,
    stationId: assigned,
    candidateStationId: candidate,
    enrollmentRequestId: requestId,
    outcome,
  })

  if (row.status === 'pending') {
    return ok(202, 'pending', 'managed_idempotent_pending')
  }

  if (row.status === 'auto_approved' || row.status === 'approved') {
    const cred = await client.query(
      `SELECT secret, revoked_at FROM StationCredentials WHERE station_id = $1`,
      [assigned]
    )
    const c = cred.rows[0] as
      | { secret: string; revoked_at: string | Date | null }
      | undefined
    if (c && c.revoked_at == null && c.secret === body.secret) {
      return ok(201, 'active', 'managed_idempotent_active')
    }
    return {
      kind: 'reject',
      error: 'enrollment_conflict',
      outcome: 'managed_request_conflict',
    }
  }

  return {
    kind: 'reject',
    error: 'enrollment_conflict',
    outcome: 'managed_request_conflict',
  }
}

async function insertPendingRotation(
  client: PgClient,
  params: {
    assignedId: string
    candidateId: string
    requestId: string
    tokenId: string
    secret: string
    fingerprint: string | null
    ip: string | null
  }
): Promise<EnrollDecision> {
  await client.query(
    `INSERT INTO StationEnrollments
       (station_id, secret, token_id, fingerprint, request_ip, status,
        enrollment_request_id, candidate_station_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     ON CONFLICT (station_id) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [
      params.assignedId,
      params.secret,
      params.tokenId,
      params.fingerprint,
      params.ip,
      params.requestId,
      params.candidateId,
    ]
  )
  return {
    kind: 'ok',
    http: 202,
    status: 'pending',
    stationId: params.assignedId,
    candidateStationId: params.candidateId,
    enrollmentRequestId: params.requestId,
    outcome: 'managed_pending_rotation',
  }
}

async function loadActiveByCandidate(
  client: PgClient,
  candidateId: string
): Promise<{ station_id: string; secret: string } | undefined> {
  const r = await client.query(
    `SELECT station_id, secret, revoked_at
     FROM StationCredentials
     WHERE candidate_station_id = $1 AND revoked_at IS NULL
     FOR UPDATE`,
    [candidateId]
  )
  const row = r.rows[0] as
    | { station_id: string; secret: string; revoked_at: string | Date | null }
    | undefined
  if (!row || row.revoked_at != null) return undefined
  return { station_id: String(row.station_id), secret: String(row.secret) }
}

async function incrementTokenUses(
  client: PgClient,
  tokenId: string
): Promise<boolean> {
  const r = await client.query(
    `UPDATE EnrollmentTokens
     SET uses = uses + 1
     WHERE token_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND (max_uses IS NULL OR uses < max_uses)
     RETURNING uses`,
    [tokenId]
  )
  return r.rows.length > 0
}

async function insertManagedCredential(
  client: PgClient,
  params: {
    stationId: string
    secret: string
    tokenId: string
    fingerprint: string | null
    ip: string | null
    candidateId: string
    requestId: string
  }
): Promise<void> {
  await client.query(
    `INSERT INTO StationCredentials
       (station_id, secret, token_id, fingerprint, enrolled_ip,
        candidate_station_id, enrollment_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.stationId,
      params.secret,
      params.tokenId,
      params.fingerprint,
      params.ip,
      params.candidateId,
      params.requestId,
    ]
  )
}

async function insertAutoApprovedAudit(
  client: PgClient,
  params: {
    stationId: string
    secret: string
    tokenId: string
    fingerprint: string | null
    ip: string | null
    requestId: string
    candidateId: string
  }
): Promise<void> {
  await client.query(
    `INSERT INTO StationEnrollments
       (station_id, secret, token_id, fingerprint, request_ip, status,
        decided_at, decided_by, enrollment_request_id, candidate_station_id)
     VALUES ($1, $2, $3, $4, $5, 'auto_approved', NOW(), 'auto', $6, $7)`,
    [
      params.stationId,
      params.secret,
      params.tokenId,
      params.fingerprint,
      params.ip,
      params.requestId,
      params.candidateId,
    ]
  )
}

async function createManaged(
  client: PgClient,
  params: EnrollParams,
  requestId: string
): Promise<EnrollDecision> {
  const candidateId = params.body.stationId
  const fp = fingerprintJson(params.body)
  const existing = await loadActiveByCandidate(client, candidateId)
  if (existing) {
    return insertPendingRotation(client, {
      assignedId: existing.station_id,
      candidateId,
      requestId,
      tokenId: params.tokenId,
      secret: params.body.secret,
      fingerprint: fp,
      ip: params.ip,
    })
  }

  for (let attempt = 0; attempt < MAX_ALLOCATE_ATTEMPTS; attempt++) {
    const stationId = allocateStationId()
    try {
      await insertManagedCredential(client, {
        stationId,
        secret: params.body.secret,
        tokenId: params.tokenId,
        fingerprint: fp,
        ip: params.ip,
        candidateId,
        requestId,
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const raced = await loadActiveByCandidate(client, candidateId)
      if (raced) {
        return insertPendingRotation(client, {
          assignedId: raced.station_id,
          candidateId,
          requestId,
          tokenId: params.tokenId,
          secret: params.body.secret,
          fingerprint: fp,
          ip: params.ip,
        })
      }
      continue
    }

    await insertAutoApprovedAudit(client, {
      stationId,
      secret: params.body.secret,
      tokenId: params.tokenId,
      fingerprint: fp,
      ip: params.ip,
      requestId,
      candidateId,
    })
    const bumped = await incrementTokenUses(client, params.tokenId)
    if (!bumped) {
      return { kind: 'auth', outcome: 'auth_token_uses_exhausted' }
    }
    return {
      kind: 'ok',
      http: 201,
      status: 'active',
      stationId,
      candidateStationId: candidateId,
      enrollmentRequestId: requestId,
      outcome: 'managed_auto_approved',
    }
  }

  throw new Error('station id allocator exhausted retries')
}

async function decideManaged(
  client: PgClient,
  params: EnrollParams,
  requestId: string
): Promise<EnrollDecision> {
  const locked = await client.query(
    `SELECT token_secret, expires_at, max_uses, uses, revoked_at
     FROM EnrollmentTokens WHERE token_id = $1
     FOR UPDATE`,
    [params.tokenId]
  )
  const token = locked.rows[0] as EnrollmentTokenRow | undefined
  if (!token) return { kind: 'auth', outcome: 'auth_unknown_token' }

  const existing = await loadEnrollmentByRequest(
    client,
    params.tokenId,
    requestId
  )
  if (existing) return replayManaged(client, existing, params.body)

  const dead = tokenLifecycleOutcome(token)
  if (dead) return { kind: 'auth', outcome: dead }

  return createManaged(client, params, requestId)
}

export async function runManagedEnrollment(
  params: EnrollParams
): Promise<EnrollDecision> {
  const requestId = params.body.enrollmentRequestId
  if (!requestId) {
    throw new Error('runManagedEnrollment requires enrollmentRequestId')
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_TXN_RETRIES; attempt++) {
    try {
      return await withClient(async (client) => {
        await client.query('BEGIN')
        try {
          const decision = await decideManaged(
            client as unknown as PgClient,
            params,
            requestId
          )
          if (decision.kind === 'auth') {
            await client.query('ROLLBACK')
            return decision
          }
          await client.query('COMMIT')
          return decision
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {})
          throw err
        }
      })
    } catch (err) {
      lastErr = err
      if (isUniqueViolation(err) && attempt < MAX_TXN_RETRIES - 1) continue
      throw err
    }
  }
  throw lastErr
}

export async function runLegacyEnrollment(
  params: EnrollParams
): Promise<EnrollDecision> {
  const stationId = params.body.stationId
  const fp = fingerprintJson(params.body)
  const tokenId = params.tokenId

  return withClient(async (client) => {
    const existing = await client.query(
      `SELECT secret, revoked_at FROM StationCredentials WHERE station_id = $1`,
      [stationId]
    )
    let cred = existing.rows[0] as
      | { secret: string; revoked_at: string | Date | null }
      | undefined

    if (cred && cred.revoked_at == null && cred.secret === params.body.secret) {
      return {
        kind: 'ok' as const,
        http: 201 as const,
        status: 'active' as const,
        stationId,
        candidateStationId: stationId,
        enrollmentRequestId: null,
        outcome: 'idempotent',
      }
    }

    if (!cred || cred.revoked_at != null) {
      try {
        await client.query('BEGIN')
        const upsert = await client.query(
          `INSERT INTO StationCredentials
             (station_id, secret, token_id, fingerprint, enrolled_ip,
              candidate_station_id, enrollment_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (station_id) DO UPDATE SET
             secret = EXCLUDED.secret,
             token_id = EXCLUDED.token_id,
             fingerprint = EXCLUDED.fingerprint,
             enrolled_ip = EXCLUDED.enrolled_ip,
             candidate_station_id = EXCLUDED.candidate_station_id,
             enrollment_request_id = EXCLUDED.enrollment_request_id,
             updated_at = NOW(),
             revoked_at = NULL
           WHERE StationCredentials.revoked_at IS NOT NULL
           RETURNING station_id`,
          [stationId, params.body.secret, tokenId, fp, params.ip, stationId, null]
        )
        if (upsert.rows.length > 0) {
          await client.query(
            `INSERT INTO StationEnrollments
               (station_id, secret, token_id, fingerprint, request_ip, status,
                decided_at, decided_by, enrollment_request_id, candidate_station_id)
             VALUES ($1, $2, $3, $4, $5, 'auto_approved', NOW(), 'auto', $6, $7)`,
            [stationId, params.body.secret, tokenId, fp, params.ip, null, stationId]
          )
          await client.query(
            `UPDATE EnrollmentTokens
             SET uses = uses + 1
             WHERE token_id = $1
               AND revoked_at IS NULL
               AND expires_at > NOW()
               AND (max_uses IS NULL OR uses < max_uses)
             RETURNING uses`,
            [tokenId]
          )
          await client.query('COMMIT')
          return {
            kind: 'ok' as const,
            http: 201 as const,
            status: 'active' as const,
            stationId,
            candidateStationId: stationId,
            enrollmentRequestId: null,
            outcome: 'auto_approved',
          }
        }
        await client.query('ROLLBACK')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      }

      const reread = await client.query(
        `SELECT secret, revoked_at FROM StationCredentials WHERE station_id = $1`,
        [stationId]
      )
      cred = reread.rows[0] as typeof cred
      if (cred && cred.revoked_at == null && cred.secret === params.body.secret) {
        return {
          kind: 'ok' as const,
          http: 201 as const,
          status: 'active' as const,
          stationId,
          candidateStationId: stationId,
          enrollmentRequestId: null,
          outcome: 'idempotent',
        }
      }
    }

    await client.query(
      `INSERT INTO StationEnrollments
         (station_id, secret, token_id, fingerprint, request_ip, status,
          enrollment_request_id, candidate_station_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       ON CONFLICT (station_id) WHERE status = 'pending' DO NOTHING`,
      [stationId, params.body.secret, tokenId, fp, params.ip, null, stationId]
    )
    return {
      kind: 'ok' as const,
      http: 202 as const,
      status: 'pending' as const,
      stationId,
      candidateStationId: stationId,
      enrollmentRequestId: null,
      outcome: 'conflict_pending',
    }
  })
}
