# HTTPS Ingest Polish Plan — burnin (dashboard/server side)

Companion plan: `~/Documents/Zigbee_UART_Interface/HTTPS_INGEST_POLISH_PLAN.md`.
All items come from the feature/https-ingest code review (2026-07-22). Everything in
Phase 1 is considered a ship blocker.

## Cross-repo coordination (read first)

- **Error-code contract**: the station client marks an outbox entry `failed_permanent`
  only for HTTP 400 + code in (`invalid_schema`, `too_large`, `station_mismatch`).
  Any change to server error codes/classes must be mirrored in
  `dashboard_ingest.try_upload_one`. Phase 1 items below deliberately move data
  errors from 500 → 400 so the client stops retrying poison payloads.
- **Golden auth vectors**: commit a shared fixture (canonical string, secret,
  timestamp, nonce, body hash → expected signature) used by tests in BOTH repos so
  the HMAC contract can never drift silently (see Phase 3 here and in the zigbee plan).
- **Rollout order**: server fixes deploy first; then stations. Disable pCloud
  FileSync per station only after its first confirmed HTTPS ingest (item 1.5).

## Phase 1 — Correctness blockers

> **Status 2026-07-22: Phase 1 complete** (all six items implemented on
> feature/https-ingest; migrations 012/013/014 added; `tsc --noEmit` and
> `npm run lint` clean). Deviation from the original plan noted in 1.1.

### 1.1 Kill the 500-poison-loop family (data errors must be 400s) — DONE
- [x] `src/lib/ingest/validate.ts` — timestamps now parsed **once** during
      validation (`ValidatedResult` carries `startTimeUtc`/`endTimeUtc`);
      `insertTest` never re-parses raw strings.
      **Decision change**: implemented (a) 400 `invalid_schema` rejection, not
      (b) store-as-INVALID — investigation showed the legacy CSV path never
      stored such rows either (`Tests.start_time` is `TIMESTAMPTZ NOT NULL` and
      `scripts/ingest.ts` calls the parser with no try/catch, failing the whole
      file), so 400-reject is the faithful semantics.
- [x] `src/lib/ingest/schema.ts` — sample + result timestamps validated against
      the shared `DELHI_TIMESTAMP_REGEX` (exported from `timestamps.ts`);
      malformed sample → 400 with `samples.<index>.timestamp` in the message.
- [x] `src/lib/ingest/schema.ts` — length caps added: `idempotencyKey ≤ 249`,
      `firmwareVersion ≤ 20`, statuses ≤ 10, `serialNumber ≤ 50`. (`station_id`,
      `status_flags`, `failure_description` are TEXT — no caps needed;
      `failureTime` already parses to null on failure, never throws.)
- [x] Acceptance verified: garbage result/sample timestamps and overlong fields
      all surface as 400 `invalid_schema`; validate/dbInsert cannot throw on
      client-supplied strings.

### 1.2 Fix `npm run reprocess` (currently destructive + broken post-HTTPS) — DONE
- [x] Migration **012** (`ingest_receipts_test_id_cascade`): re-creates the
      `IngestReceipts.test_id` FK as `ON DELETE CASCADE` (constraint looked up
      by name via `pg_constraint` since 010 auto-named it).
- [x] `scripts/reprocess.ts` — partial clear: TestData/Tests deleted only where
      `source_file IS NULL OR NOT LIKE 'https:%'`; only orphan Inverters
      removed; sequence resets replaced with `setval(MAX(id)+1)` so re-ingest
      can't collide with surviving HTTPS row ids.
- [x] Acceptance reasoning verified: `usedFilesCache` https entries are
      harmless (compared against CSV basenames only); HTTPS tests keep valid
      `current_test_id` annotation links; CSV annotations relink post-ingest
      via the existing `ON DELETE SET NULL` + relink flow. (Not run against
      the live DB — run `npm run migrate` at deploy.)

### 1.3 Gzip bomb + event-loop blocking — DONE
- [x] Async `promisify(zlib.gunzip)` with `maxOutputLength = maxBodyBytes * 8`
      (derived from existing config so operator overrides scale it);
      `RangeError`/`ERR_BUFFER_TOO_LARGE` → 400 `too_large`, other gunzip
      failures keep the prior 400 `invalid_schema` behavior.
- [x] Acceptance: over-inflating body → 400 without large allocation; event
      loop no longer blocked during decompression.

### 1.4 One source of truth for station enablement — DONE
- [x] `enabled` removed from `StationConfig`, config.json parsing, the
      `INGEST_STATIONS_JSON` fallback, `config.template.json`, and both docs;
      docs now describe the real mechanism (StationControls via `/stations`
      admin UI, no-row defaults to enabled).
- [x] Dead `station_disabled` reason removed from `IngestAuthFailure`; the live
      DB-driven 403 in route.ts (`isStationEnabled` → route-local literal) is
      unchanged.
- [x] Acceptance: grep for `enabled` in the ingest config path is clean.

### 1.5 Cross-pipeline dedup (migration window) — DONE
- [x] Shared guard `findExistingTestByInvStart` (1 s tolerance, mirroring the
      annotation-restore dedup convention) applied in both
      `processPayload.ts` (returns the existing duplicate `ProcessSuccess`
      shape + writes the receipt against the existing test) and
      `scripts/ingest.ts` (skip-and-log before insert; compares only against
      rows already in the DB so multi-row/RETEST batch logic is untouched).
- [x] Migration **013**: partial unique index on
      `(inv_id, start_time_utc) WHERE start_time_utc IS NOT NULL`, created only
      if no pre-existing duplicate groups exist (otherwise `RAISE WARNING` with
      counts and skip — retry by deleting the 013 migrations row after cleanup).
      The 23505 handler also resolves violations of this index as duplicates.
- [x] Acceptance: second arrival via either path is a duplicate/skip, not a
      second row.

### 1.6 Replay protection honesty — DONE
- [x] Migration **014**: `IngestNonces(nonce PK, station_id, seen_at)` +
      seen_at index. `verifyIngestRequest` is now async: skew → HMAC verify →
      atomic nonce claim (`INSERT ... ON CONFLICT DO NOTHING RETURNING`), with
      opportunistic pruning at TTL = 2× skew window. Signature-before-nonce
      ordering prevents unauthenticated nonce poisoning. DB unreachable →
      fail closed (500, station retries). Both route call sites updated;
      docs/INGEST_PRODUCTION.md "out of v1" note replaced with the real design.
      (`opsAuth.ts` still has its own in-memory Map — Phase 2.2 consolidation.)

## Phase 2 — Consolidation & efficiency

### 2.1 One ingest core, two transports (highest-leverage refactor)
- [ ] `src/lib/ingest/timestamps.ts`, `validate.ts`, and the
      insert/COPY/relink helpers in `dbInsert.ts` are verbatim forks of private
      logic in `scripts/ingest.ts` (Delhi→UTC math, INVALID rules, 41-column COPY
      list, `ensureInverter`, annotation relink). The script runs under tsx and
      can import `src/lib/ingest/*` directly. Make `src/lib/ingest` the single
      source and have `CSVIngester` consume it. Drift already happened once this
      branch (AC-header alias patched in two places).
- [ ] Include the multi-row priority-selection rules in the shared core so the
      station client can reference one documented behavior (see zigbee plan 1.6).

### 2.2 One HMAC verify core
- [ ] `src/lib/ingestAuth.ts` re-implements `src/lib/opsAuth.ts` nearly
      line-for-line (canonical builder, skew, nonce map, timingSafeEqual).
      Extract a shared verify core parameterized by header prefix/canonical
      fields/skew, used by both.

### 2.3 Auth helper + dead code removal
- [ ] `src/lib/auth-check.ts` — factor a generic `makeAllowlistAuth(envVar,
      defaults)`; restore + station-admin quartets currently diverge on
      SKIP_AUTH handling. Move hardcoded personal emails out of source.
- [ ] Delete: unused `HEAD /api/stations` handler (`src/app/api/stations/route.ts:27`,
      UI uses `/api/stations/admin-status`), `bodyStationId` param + unreachable
      `station_mismatch` branch in `ingestAuth.ts`/route, unused exports
      `hashBody`, `truncateToSeconds`, `isAuthSkipped`.
- [ ] `src/lib/ingest/processPayload.ts` — dedupe the copy-pasted idempotency
      lookup + duplicate-result literal (appears pre-insert and in the 23505
      handler): one `findExistingByKey` + one `duplicateResult` builder.

### 2.4 Connection & query efficiency
- [ ] Shared module-level `pg.Pool`; `processPayload.ts` and
      `src/lib/stationControls.ts` `withClient` currently open a fresh Client
      per call (2 connects per ingest POST, 1 per policy poll per 30 s).
- [ ] Drop the per-ingest `SELECT COUNT(*) FROM Tests` (processPayload.ts:105) —
      use `pg_class.reltuples` or remove the field.
- [ ] Reuse `bodySha256Hex` from `verifyIngestRequest` instead of re-hashing
      the raw body in route.ts:133; length-check `samples` count before full
      zod parse.
- [ ] `src/app/stations/page.tsx` — fetch admin-status once (not every 30 s
      tick); narrow/cache the per-station historical aggregate query behind
      `/api/stations`.

### 2.5 Simplifications
- [ ] `parseTimestampFromDelhi` — replace the manual borrow ladder with
      `new Date(Date.UTC(y, mo - 1, d, h - 5, min - 30, sec, ms))` (Date.UTC
      normalizes out-of-range components). Verify against existing data first
      (Phase 3 round-trip test).
- [ ] `src/middleware.ts` — export a single `PUBLIC_API_PREFIXES` constant that
      drives both the runtime check and the matcher, so the route list lives in
      one place (currently three).

## Phase 3 — Tests (feature ships with these, not after)

No test infrastructure exists in this repo today. Add vitest (or `node:test`).

- [ ] **HMAC contract test**: verify the shared golden vectors (same fixture file
      as the zigbee repo) against `verifyIngestRequest` — signature, skew
      rejection, nonce reuse rejection.
- [ ] **Schema tests**: `ingestPayloadSchema` — accepts a real captured station
      payload; rejects `runId: null`, bare `NaN` (invalid JSON path), overlong
      idempotencyKey/firmware/status; sample timestamp format enforcement.
- [ ] **Timestamp round-trip**: Delhi→UTC across month/year/leap boundaries;
      lock behavior before the Date.UTC simplification (2.5).
- [ ] **processPayload integration** (against a scratch DB): happy path,
      duplicate (idempotency), INVALID-but-stored result, cross-pipeline dedup.
- [ ] **Route-level**: gzip-bomb body → 400 `too_large`; oversized compressed
      body → 413/400.
