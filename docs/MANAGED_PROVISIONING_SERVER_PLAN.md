# Managed Provisioning: Server-Side Implementation Plan

**Status:** implementation handoff  
**Repository:** `burnin` dashboard  
**Client repository:** `Zigbee_UART_Interface`  
**Compatibility requirement:** existing enrolled stations and older station
clients must continue to work during rollout.

## 1. Outcome

Change `POST /api/stations/v1/enroll` so the dashboard, rather than the
manufacturing PC, owns the durable station ID.

A new station client sends:

- a client-generated candidate `stationId` in the body and `X-Station-Id`
  header;
- a persisted random `enrollmentRequestId`;
- its persisted 64-hex per-station HMAC secret;
- its machine fingerprint; and
- the existing bootstrap-token authentication headers.

For requests containing `enrollmentRequestId`, the server allocates an opaque
station ID once and returns that same ID on every valid retry. The candidate
ID remains only a bootstrap/signature value and a useful re-image correlation
hint. It must not become the new station's primary key.

The station client already accepts either of these response shapes and treats
the returned station ID as authoritative:

```json
{
  "ok": true,
  "stationId": "MFG-2a444a63-f228-44a2-ae5c-cdf863c8f049",
  "status": "active"
}
```

```json
{
  "ok": true,
  "stationId": "MFG-2a444a63-f228-44a2-ae5c-cdf863c8f049",
  "status": "pending"
}
```

HTTP 201 means enrolled; HTTP 202 means pending approval. The client persists
the returned ID before taking any later action.

## 2. Existing behavior to preserve

The current implementation already provides:

- bootstrap token lookup, expiry, revocation, and maximum-use checks;
- HMAC verification, timestamp skew validation, and nonce replay protection;
- per-station credentials in `StationCredentials`;
- enrollment audit/pending records in `StationEnrollments`;
- administrator approval/rejection routes and UI;
- DB-first secret resolution for ingest and policy requests; and
- candidate-ID enrollment for old clients.

Do not migrate or rename existing `StationCredentials.station_id` values.
They remain valid durable station IDs. Do not change the ingest or station
policy HMAC contracts.

Requests without `enrollmentRequestId` must continue through today's legacy
candidate-ID decision path until old manufacturing builds have been retired.

## 3. New wire contract

Extend the enrollment Zod schema in
`src/app/api/stations/v1/enroll/route.ts`:

```ts
const enrollmentRequestIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

const enrollBodySchema = z.object({
  stationId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  enrollmentRequestId: enrollmentRequestIdSchema.optional(),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.object({
    hostname: z.string().optional(),
    machineId: z.string().optional(),
    os: z.string().optional(),
    appVersion: z.string().optional(),
  }).optional(),
}).strict()
```

The current Python client generates `uuid.uuid4().hex`, hence the lowercase
32-hex format. Keep the field optional only for the legacy compatibility
window.

Authentication remains unchanged: the HMAC canonical string uses the exact
`X-Station-Id` value supplied in that request. Before processing enrollment,
require the body `stationId` to equal `X-Station-Id`.

On the first managed request, that value is the candidate ID. After a 202
response the client adopts the returned server ID, so subsequent retries may
use the assigned ID in both the body and header. The managed idempotency path
must therefore accept either the original candidate ID or the assigned ID for
an existing request.

## 4. Database migration

Add a new migration after `017` in `scripts/migrate-db.ts`. Do not edit
migration `017`, because it may already be recorded in production.

Recommended additive changes:

```sql
ALTER TABLE StationEnrollments
  ADD COLUMN IF NOT EXISTS enrollment_request_id TEXT,
  ADD COLUMN IF NOT EXISTS candidate_station_id TEXT;

UPDATE StationEnrollments
SET candidate_station_id = station_id
WHERE candidate_station_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stationenrollments_token_request
  ON StationEnrollments (token_id, enrollment_request_id)
  WHERE enrollment_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stationenrollments_candidate
  ON StationEnrollments (candidate_station_id, requested_at DESC);

ALTER TABLE StationCredentials
  ADD COLUMN IF NOT EXISTS candidate_station_id TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_request_id TEXT;

UPDATE StationCredentials
SET candidate_station_id = station_id
WHERE candidate_station_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_stationcredentials_candidate
  ON StationCredentials (candidate_station_id)
  WHERE revoked_at IS NULL;
```

Add database checks for new non-null request IDs without breaking legacy
rows. The application Zod schema is the primary format gate; a DB check may
also enforce `enrollment_request_id ~ '^[0-9a-f]{32}$'` when non-null.

`StationEnrollments.station_id` continues to mean the authoritative/assigned
station ID. `candidate_station_id` records what the machine proposed on its
first request. Store the request ID on both the audit row and credential so
operators can trace the complete enrollment.

Do not make `candidate_station_id` globally unique. A re-imaged PC or a rare
candidate collision must enter the pending-review path instead of causing a
database error.

## 5. Opaque station ID allocation

Add a small server-only helper, preferably under `src/lib/`, using Node's
cryptographic RNG. One acceptable format is:

```ts
`MFG-${randomUUID()}`
```

This satisfies the client's `[A-Za-z0-9._-]{1,64}` validator and is opaque.
Never derive the assigned ID from hostname, MAC, fingerprint, request ID, IP,
or secret.

The database primary key remains the final collision authority. If inserting
a newly generated station ID reports a unique-key collision, generate another
and retry a small bounded number of times inside the transaction. Do not use
`MAX(station_id) + 1` or another race-prone allocator.

## 6. Managed enrollment decision algorithm

Keep the current legacy algorithm in a separate helper. Route bodies with an
`enrollmentRequestId` through a new managed helper using one database
transaction.

### 6.1 Authenticate before revealing enrollment state

1. Read the bootstrap-token row, including its secret and lifecycle fields.
2. Verify the HMAC, timestamp, and nonce before returning any request-specific
   information.
3. Parse and strictly validate the body.
4. Require body `stationId` to equal the authenticated header station ID.

Unknown token IDs cannot be authenticated and always return the existing
generic 401 response.

### 6.2 Resolve idempotent retries before rejecting token lifecycle

After authentication, query `StationEnrollments` by
`(token_id, enrollment_request_id)`.

If a record exists:

- require the submitted secret to exactly match the stored secret;
- require the submitted/header station ID to equal either
  `candidate_station_id` or authoritative `station_id`;
- never allocate another ID, insert another audit row, or increment token
  usage;
- return 201 with the saved station ID when the enrollment is
  `auto_approved` or `approved` and its credential is active with the same
  secret;
- return 202 with the saved station ID while status is `pending`;
- return a permanent 400 error such as `enrollment_rejected` when status is
  `rejected`; and
- return a permanent 400 error if the request ID is reused with conflicting
  immutable material.

The Python client currently treats 400 and 401 as permanent enrollment
failures, while other unexpected statuses retry. Use 400 for rejected or
conflicting request IDs unless the client is changed in lockstep.

An authenticated retry of an already-created enrollment should return its
saved outcome even if the bootstrap token has since expired, reached its use
limit, or was revoked. This is essential when the server committed a 201/202
but the response was lost. It does not authorize a new enrollment.

### 6.3 Decide a new request

Only when no idempotency record exists should token lifecycle and capacity
rules gate creation. Re-check them under a row lock (`SELECT ... FOR UPDATE`)
inside the transaction so concurrent first enrollments cannot exceed
`max_uses`.

Then correlate the candidate ID:

- If there is no active credential previously associated with that candidate,
  allocate a new opaque station ID, insert the credential, insert an
  `auto_approved` enrollment audit row, increment token uses once, and return
  201.
- If that candidate is already associated with an active credential but this
  is a new request ID/secret, reuse the existing authoritative station ID for
  this request, insert one `pending` rotation/re-image request, and return 202.

This preserves the useful existing behavior for a re-imaged machine: it asks
an administrator before replacing an active credential, but it retains the
same authoritative station ID after approval. A different PC receiving a
copied application folder derives a different candidate and receives a new
opaque station ID automatically.

The transaction must atomically persist the assigned ID, secret, request ID,
candidate ID, audit record, credential, and token-use increment before 201 is
returned.

### 6.4 Concurrency

Expect two simultaneous first requests with the same request ID. The unique
index is the arbiter:

- one transaction creates the record;
- the loser re-reads `(token_id, enrollment_request_id)` and follows the
  idempotent retry path; and
- both responses contain the same authoritative station ID.

Likewise, serialize candidate re-enrollment decisions sufficiently to avoid
creating two pending rotations. The current partial pending index may remain,
but its conflict key should operate on the authoritative `station_id`. Always
re-read after `ON CONFLICT DO NOTHING`.

## 7. Approval and rejection changes

Update `src/app/api/stations/enrollments/[id]/route.ts`:

- approval writes the row's authoritative `station_id`, secret,
  `candidate_station_id`, and `enrollment_request_id` into
  `StationCredentials`;
- approval of a re-image request rotates the secret on the existing assigned
  station ID;
- rejection remains terminal for that request ID; subsequent retries must not
  create a new pending row;
- two administrators racing to decide the same row still yield one decision;
  and
- no API response or log prints either the station secret or bootstrap secret.

Update `GET /api/stations/enrollments` to return
`enrollmentRequestId` and `candidateStationId` for diagnosis, while continuing
to exclude secrets. Update the `/stations` page so a pending row clearly shows
the assigned ID, candidate ID, hostname/machine fingerprint, request ID,
release/app version, token label/ID, request time, and IP.

## 8. Logging and observability

Enrollment decision logs should include:

- assigned station ID when known;
- candidate station ID;
- enrollment request ID;
- token ID;
- request IP; and
- a stable outcome such as `managed_auto_approved`, `managed_pending_rotation`,
  `managed_idempotent_active`, `managed_idempotent_pending`,
  `managed_rejected`, or `managed_request_conflict`.

Never log either secret or the raw request body. Treat the fingerprint as
operator-visible diagnostic information, not authentication proof.

## 9. Tests required

Extend `tests/enrollRoute.test.ts` and its fake database so unknown SQL still
fails loudly. Cover at least:

1. New managed request returns 201 with a server-generated ID different from
   the candidate and stores all mappings.
2. Lost-response retry returns the identical assigned ID and does not create
   rows or increment token uses again.
3. Retry after adopting the assigned ID is accepted even though the first
   request used the candidate ID.
4. Same request ID with a different secret, unrelated candidate, or different
   token cannot mutate the original enrollment.
5. Existing pending request returns the same assigned ID and 202.
6. Approved pending request returns the same assigned ID and 201.
7. Rejected request returns a permanent 400 and never requeues.
8. Expired, revoked, or exhausted token rejects a genuinely new request.
9. A previously persisted idempotent request still resolves after token
   expiry/revocation/exhaustion.
10. Candidate collision/re-image creates one pending rotation against the
    prior assigned ID.
11. Concurrent duplicate first requests converge to one credential, one audit
    row, one token-use increment, and one assigned ID.
12. Legacy body without `enrollmentRequestId` retains current behavior.
13. Response and list/admin endpoints never expose station or token secrets.
14. The allocator output always satisfies the client station-ID validator.

Extend `tests/stationAdminRoutes.test.ts` for the new fields, approval mapping,
terminal rejection, and secret non-disclosure. Add or extend migration/schema
coverage so the unique idempotency index and nullable legacy columns are
pinned against PostgreSQL semantics, not only the fake client.

Run:

```bash
npm test
npm run lint
npm run build
```

## 10. Deployment sequence

1. Deploy the additive database migration first.
2. Deploy the backward-compatible server route and admin UI.
3. Use a manually signed request or a development station to verify both
   legacy and managed bodies against production-like infrastructure.
4. Mint a short-lived, low-`max_uses` manufacturing bootstrap token.
5. Build and smoke-test the Windows managed station executable.
6. Roll out to one fresh PC and one copied-directory PC; confirm distinct
   authoritative station IDs.
7. Exercise a lost-response retry and a pending approval before broad rollout.
8. Monitor enrollment outcome logs and the `/stations` admin page.
9. Revoke the release token after the expected stations enroll.
10. Remove the legacy no-`enrollmentRequestId` path only after all deployed
    station builds are known to use managed provisioning.

## 11. Acceptance criteria

The server work is complete when:

- it, not the client, selects IDs for managed station enrollments;
- `(token_id, enrollmentRequestId)` is durable and idempotent across crashes,
  retries, concurrent requests, deployments, and token expiry;
- a copied application directory on another PC creates a distinct station;
- re-imaging the same candidate cannot silently replace an active secret;
- old clients and existing station IDs continue to function;
- approval, rejection, credential revocation, ingest, and remote station
  policy all use the authoritative ID consistently;
- secrets are absent from API responses, logs, and the admin UI; and
- migration, route, admin, lint, test, and production build checks pass.

## 12. Out of scope for this change

- Renaming or renumbering already-enrolled stations.
- Changing ingest/policy request signing.
- Automatic credential rotation for a running, healthy station.
- Treating hostname, MAC, candidate ID, fingerprint, or IP as proof of
  identity. They are correlation and operator-review data only.

