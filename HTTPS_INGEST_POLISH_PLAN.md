# HTTPS Ingest Polish Plan — burnin (dashboard/server side)

Companion plan: `~/Documents/Zigbee_UART_Interface/HTTPS_INGEST_POLISH_PLAN.md`.
All items come from the feature/https-ingest code review (2026-07-22). Everything in
Phase 1 is considered a ship blocker.

## Cross-repo coordination (read first)

- **Error-code contract** *(updated 2026-07-27 — station Phase 1 landed)*: the
  station client now classifies by status class, not string matching:
  any 4xx except 401/403/408/429 → `failed_permanent`; 401/403 → long backoff
  (`retry_backoff_max_sec`, default 1 h) + loud operator alert; 408/429/5xx/
  network → exponential backoff capped at `retry_backoff_max_sec`. The 400
  `code` field is recorded for diagnostics but no longer gates permanence.
- **Golden auth vectors** *(landed 2026-07-27)*: shared fixture committed as
  `tests/fixtures/hmac_golden_vectors.json` in BOTH repos (identical file;
  generated from the station's `sign_request`, verified against
  `src/lib/ingestAuth.ts` canonical-string spec). Phase 3 HMAC tests here must
  consume this file.
- **Serial canonical form** *(station change 2026-07-27)*: the station no longer
  zero-pads serials to 12 digits; `serialNumber` on the wire is the raw results-
  CSV value (stripped), matching what the legacy CSV pipeline stores — so
  cross-pipeline dedup and idempotency keys agree with existing DB rows.
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

> **Status 2026-07-27: Phase 2 complete** (2.1–2.5) on feature/https-ingest.
> Test infra landed early (vitest, `npm test`) because the pinning tests gate
> these refactors — see Phase 3 notes. `tsc --noEmit`, `npm run lint`, and
> `npm test` (70 tests) all clean.

### 2.1 One ingest core, two transports (highest-leverage refactor) — DONE
- [x] `src/lib/ingest` is the single source; `scripts/ingest.ts` (CSVIngester)
      imports `timestamps`/`validate`/`dbInsert`/`schema` relatively (not the
      barrel — the barrel's runtime graph pulls Next-side `@/` deps). Shared:
      Delhi→UTC math, INVALID rules (`evaluateResultRow`), multi-row selection
      (`selectBestResult`), 41-column COPY (`insertSamplesCopy`),
      `ensureInverter`, `insertTest`, cross-pipeline dedup, annotation relink
      (`relinkAllAnnotations` + per-test variant). CSV-specific string→number
      parsing stays in the script.
- [x] Priority-selection rule documented on `evaluateResultRow` in
      `src/lib/ingest/validate.ts` (4 valid > 3 INVALID > 2 short-duration >
      1 start>end; single-row always processed; first-row-wins ties; all-P1
      multi-row file skipped; debug-firmware demotion server-side only). The
      station's `_row_priority` mirrors this — changes must be flagged in both
      plan files.

### 2.2 One HMAC verify core — DONE
- [x] `src/lib/hmacVerifyCore.ts`: `verifyHmacCore` parameterized by header
      prefix, expected-signature closure, and nonce-claim function (sync/async
      overloads). `ingestAuth.ts` keeps DB-backed nonces + fail-closed;
      `opsAuth.ts` stays in-memory **deliberately** (low volume, 60 s skew,
      must work when Postgres is down; documented in-file). Golden vectors
      unchanged and green — wire behavior identical.

### 2.3 Auth helper + dead code removal — DONE
- [x] `makeAllowlistAuth({envVar, configKey, ...})` in auth-check.ts; both
      gates are instances. SKIP_AUTH now bypasses allowlists for BOTH gates
      (station-admin behavior; dev-only change). Allowlist defaults moved to
      config.json `auth` section (env vars still win). **Deploy note:
      production config.json needs the `auth` section (or env vars) — see
      HANDOFF/deploy checklist.**
- [x] Deleted with zero-caller grep evidence: `HEAD /api/stations`,
      `bodyStationId` + `station_mismatch` auth branch (the post-schema
      header≠body check in route.ts remains and still returns
      `station_mismatch` — docs/INGEST_API.md stays accurate), `hashBody`
      (2.4 wave), `truncateToSeconds`, `isAuthSkipped`.
- [x] `processPayload.ts` idempotency-lookup + duplicate-literal dedupe
      (folded into the 2.4 wave, same file).

### 2.4 Connection & query efficiency — DONE
- [x] Shared lazy `pg.Pool` in `src/lib/db.ts` (max 10, idle-error handler);
      `stationControls.withClient` (signature unchanged) and `processPayload`
      both check out of it — 0 fresh connects per ingest POST / policy poll
      after warmup. Error paths destroy the client (`release(true)`) so a
      dirty/open-transaction client never re-enters the pool. Scripts keep
      their own Clients (they never import `db.ts`).
- [x] Per-ingest `COUNT(*)` replaced with `pg_class.reltuples` estimate
      (`-1`/missing → null); `totalTests` only feeds the best-effort
      ops-status file and `/api/health` prefers the live exact count.
- [x] Route reuses `bodySha256Hex` from the auth success result (hash still
      computed lazily post-skew-check inside verification); over-limit
      `samples` short-circuits post-JSON.parse/pre-zod with the same 400
      `too_large` contract.
- [x] Stations page fetches admin-status once per mount; the per-station
      historical aggregate is one grouped Tests scan cached 30 s (matches the
      page poll interval). Control state (enabled/reason/revision) is never
      cached; stats/new-station appearance may lag ≤30 s.

### 2.5 Simplifications — DONE
- [x] `parseTimestampFromDelhi` borrow ladder replaced with a single
      `Date.UTC(...)` — gated by the exhaustive boundary sweep in
      `tests/timestamps.test.ts` (every hour of the first/last two days of
      every month 2023–2026), written and passing against the OLD
      implementation first.
- [x] `src/middleware.ts` — **deviation from plan**: Next.js requires
      `config.matcher` values to be static literals (dynamic values are
      silently ignored by the build-time analyzer), so one constant cannot
      drive the matcher. Landed instead: `PUBLIC_PREFIXES`/`PUBLIC_EXACT`
      drive the runtime check via `isPublicPath()`, and
      `tests/middleware.test.ts` pins the matcher literals against the
      constants so the route list can't drift (route list now lives in one
      authoritative place + one pinned mirror, down from three unpinned).

## Phase 3 — Tests (feature ships with these, not after)

Infra: **vitest** (`npm test`, `vitest.config.ts` with the `@` alias, tests
under `tests/`). Landed 2026-07-27 ahead of the Phase 2 refactors to pin
behavior first.

- [x] **HMAC contract test** (`tests/hmac.test.ts`): all 4 shared golden
      vectors (fixture `tests/fixtures/hmac_golden_vectors.json`, byte-
      identical with the station repo) + canonical layout, skew rejection,
      nonce replay rejection, bad-signature-doesn't-consume-nonce, fail-closed
      on nonce-store loss (mocked `withClient`).
- [x] **Schema tests** (`tests/schema.test.ts`): realistic payload accepted;
      `runId: null` rejected / omitted accepted; overlong + at-limit bounded
      fields; sample timestamp format with `samples.<i>.timestamp` in the
      error path; passthrough of unknown sample keys. (Bare `NaN` is an
      invalid-JSON case, covered at route level, not in zod.)
- [x] **Timestamp round-trip** (`tests/timestamps.test.ts`): boundary cases +
      exhaustive sweep; written against the old borrow ladder BEFORE 2.5.
- [x] **processPayload integration** (`tests/processPayload.test.ts`):
      happy path, duplicate via receipt AND via `Tests.idempotency_key`,
      INVALID-but-stored, cross-pipeline dedup (sub-second drift), 23505
      race resolution, server_error + connection-destroy. **Deviation:** runs
      against a scripted in-memory fake pg client, not a scratch DB (schema/
      migration scripts resolve their target from config.json = the live DB,
      so a real scratch DB wasn't safely reachable — see the file's header
      for exactly what is and isn't covered; the fake throws on unrecognized
      SQL so flow changes fail loudly).
- [x] **Route-level** (`tests/ingestRoute.test.ts`): gzip bomb → 400
      `too_large` (capped inflate); oversized compressed body → 400
      `too_large`; corrupt gzip / non-JSON / schema violation → 400
      `invalid_schema`; over-maxSamples → 400 `too_large`; bad signature →
      401; disabled station → 403; happy path asserts the verified body hash
      is what processing receives; processing failure → 500. Pins the
      status-class contract the station's retry policy classifies on.
- [x] **Bonus — selection-rule pin** (`tests/validate.test.ts`): the shared
      MULTI-ROW PRIORITY-SELECTION RULE (mirrored by the station's
      `_row_priority`) — priorities 4/3/2/1, single-row-always, first-wins
      ties, all-P1 skip.
