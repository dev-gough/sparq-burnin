# HANDOFF — HTTPS Ingest Phase 2 + 3 (dashboard/server side)

> **STATUS 2026-07-27: FULFILLED.** Phase 2 (2.1–2.5) and Phase 3 are
> complete on feature/https-ingest; see the plan file's per-item status
> notes. `tsc`/`lint`/`npm test` (70 tests) clean. Remaining before ship:
> Devon's review + commit, `npm run migrate` at deploy (012–014), and the
> production config.json needs the new `auth` allowlist section (or the
> `RESTORE_ALLOWLIST`/`STATION_ADMIN_ALLOWLIST` env vars) — without it those
> admin endpoints deny everyone. Then the station repo's Phase 2/3.

**Audience:** the next worker (human or agent session) picking up this repo.
**Branch:** `feature/https-ingest` — base branch is `master`. Diff your work
against `master`.
**Your task:** implement Phase 2 (items 2.1–2.5) and Phase 3 (tests) of
`docs/HTTPS_INGEST_POLISH_PLAN.md` in this repo. The plan file is the authoritative
task list; this doc is the context you need to execute it well.

Sequencing across repos (Devon's call): this repo's Phase 2/3 happens FIRST,
then the station repo (`~/Documents/Zigbee_UART_Interface`) gets its Phase 2/3.
Anything you change that affects the wire contract or the shared selection
rules must be flagged for that later session (see "Cross-repo" below).

## Context in one paragraph

Burn-in stations (Python/Tk, the Zigbee_UART_Interface repo) used to deliver
test results as CSVs synced via pCloud, picked up by `scripts/ingest.ts` here.
The `feature/https-ingest` branches on both repos replace that with direct
HTTPS: stations POST gzipped, HMAC-signed JSON to `/api/ingest/v1/tests` and
poll `/api/stations/v1/config` so admins can remotely disable a station. Phase
1 (correctness blockers) is **done and committed on both sides** — here as
commit `d0c9cf9` (migrations 012–014), on the station side as uncommitted
work dated 2026-07-27 that Devon is reviewing. What remains here is
consolidation (Phase 2) and the test suite the feature ships with (Phase 3).

## Current repo state (as of 2026-07-27)

- Committed: Phase 1 complete (`d0c9cf9 Harden HTTPS ingest: Phase 1
  correctness blockers.`). `tsc --noEmit` and `npm run lint` were clean at
  that commit.
- **Uncommitted, intentional — do not revert:**
  - `docs/HTTPS_INGEST_POLISH_PLAN.md` — cross-repo coordination section updated
    with the station's Phase-1 contract changes.
  - `tests/fixtures/hmac_golden_vectors.json` (untracked) — the shared golden
    HMAC fixture, copied verbatim from the station repo. Commit it with your
    Phase 3 work; it must stay byte-identical in both repos.
- Migrations 012–014 exist in the repo but have **not been run against the
  live DB** — deploy step is `npm run migrate` (014 is load-bearing: without
  it every signed request fails closed with 500).
- No test infrastructure exists yet. Phase 3 says add vitest or `node:test`
  (your choice; pick one and note it in the plan file).

## What the station's Phase 1 changed (you are now coding against this)

The station client (`burnin/dashboard_ingest.py` + `station_policy.py` in the
other repo) was rewritten on 2026-07-27. Server-relevant facts:

- **Retry policy is status-class based.** Any 4xx except 401/403/408/429 →
  client marks the payload `failed_permanent` (test is dropped client-side).
  401/403 → client keeps retrying at its max backoff (default 1 h) and alarms
  the operator. 408/429/5xx/network → exponential backoff. The 400 `code`
  string (`invalid_schema` / `too_large` / `station_mismatch`) is recorded for
  diagnostics only — it no longer gates permanence. Practical consequence: a
  new 4xx you introduce for a transient condition WILL permanently destroy
  station payloads; use 5xx/429 for anything retryable.
- **Serials arrive raw** — the station no longer zero-pads to 12 digits;
  `serialNumber` is the raw results-CSV value (stripped). This matches what
  the legacy CSV pipeline stores, so cross-pipeline dedup by
  `(inv_id, start_time_utc)` and existing DB rows agree. Don't add
  padding/normalization server-side without a cross-repo decision.
- **`runId` is omitted** (never null) when the station has no run id — as the
  `z.string().optional()` schema requires.
- **Multi-row priority selection is now mirrored client-side**
  (`load_result_row` in the station repo replicates the rule in
  `scripts/ingest.ts` ~lines 408–465: priority 4 valid > 3 INVALID > 2
  short-duration > 1 start>end; single row processed regardless; multi-row
  all-P1 file skipped; first row wins ties). The one deliberate gap: the
  debug-firmware demotion depends on `config.settings.debug_firmware_version`,
  which the station can't see — the server stays the backstop for that.
  **This matters for plan 2.1**: when you extract the shared ingest core,
  keep the documented rule stable; if the priority rules change, the
  station's `_row_priority()` must change too (flag it in BOTH plan files).
- Fresh nonce per attempt, including retries of the same payload (DB-backed
  replay protection from migration 014 works as designed).

## Golden HMAC vectors (Phase 3 input, already generated)

`tests/fixtures/hmac_golden_vectors.json` — 4 vectors, format:
`{secret, stationId, method, path, timestamp, nonce, bodyUtf8, bodySha256,
expectedSignature}` plus a prose `algorithm` field. Canonical string is
`timestamp\nnonce\nMETHOD\npath\nstationId\nsha256hex(bodyBytes)`, HMAC-SHA256
hex — generated from the station's `sign_request` and hand-verified against
`src/lib/ingestAuth.ts` (`buildIngestCanonical`). The station repo pins these
in `tests/test_dashboard_ingest.py::test_sign_request_matches_golden_vectors`.
Your Phase 3 HMAC test must consume this file, not re-derive values. If you
touch the canonical string in 2.2 (shared verify core), the vectors must keep
passing — they are the drift alarm.

## Decisions already ratified by Devon — do not relitigate

1. Unparseable timestamps → reject with 400 `invalid_schema`, don't
   store-as-INVALID (legacy never stored them either).
2. Station enablement lives ONLY in the StationControls table (admin UI at
   `/stations`); the config.json `enabled` flag is deleted. Keep it dead.
3. Stale policy on the station side: keep last-known verdict, surface
   staleness, never fail closed. (Station-side, but don't design server
   changes that assume otherwise.)
4. Rollout order: dashboard deploys first (`npm run migrate`), stations
   upgrade after; pCloud FileSync stays on per station until its first
   confirmed HTTPS ingest (cross-pipeline dedup makes the overlap window
   safe).

## Suggested execution order

Phase 3 and Phase 2 interlock: several refactors are risky without tests that
pin current behavior first. Recommended order:

1. **Test infra + behavior-pinning tests first** (Phase 3 subset):
   - vitest (or node:test) wiring, a `npm test` script.
   - HMAC contract test against the golden vectors (`verifyIngestRequest`:
     signature, skew rejection, nonce reuse rejection — nonce test needs a
     scratch DB or a mocked pool).
   - **Timestamp round-trip test** across month/year/leap boundaries — this
     explicitly gates 2.5's `Date.UTC` simplification. Lock current behavior
     BEFORE touching `parseTimestampFromDelhi`.
   - Schema tests (reject `runId: null`, overlong fields, bad sample
     timestamps; accept a real captured station payload).
2. **2.1 One ingest core, two transports** — the highest-leverage refactor.
   `scripts/ingest.ts` runs under tsx and can import `src/lib/ingest/*`
   directly. Move the forked logic (Delhi→UTC math, INVALID/priority rules,
   41-column COPY list, `ensureInverter`, annotation relink) into
   `src/lib/ingest` and make `CSVIngester` consume it. Drift already happened
   once on this branch (AC-header alias patched in two places). Document the
   priority-selection rule in the shared core (the station references it).
3. **2.2 + 2.3 auth consolidation & dead code** — shared verify core for
   `ingestAuth.ts`/`opsAuth.ts` (note: `opsAuth` still uses an in-memory nonce
   Map; decide whether it moves to the DB table or stays — either is fine,
   just document); allowlist-auth factory; delete the listed dead exports.
4. **2.4 connection/query efficiency** — shared `pg.Pool` (biggest win: 2
   fresh connects per ingest POST today), drop per-ingest `COUNT(*)`, reuse
   `bodySha256Hex`, stations-page query caching.
5. **2.5 simplifications** — timestamp simplification (now gated tests
   exist), `PUBLIC_API_PREFIXES` in middleware.
6. Remaining Phase 3 integration tests (processPayload against a scratch DB,
   gzip-bomb route test).

What worked well previously in both repos: waves of 2–3 parallel subagents
with tight scopes and explicit do-not-touch lists, exclusive file ownership
per wave, then the orchestrator reads the merged result of any file touched
by multiple agents. Re-read current file state; never trust the plan's line
numbers.

## Verification

- `npx tsc --noEmit` and `npm run lint` must stay clean; add `npm test` and
  keep it green.
- DB-touching tests: use a scratch database (see `scripts/migrate-db.ts` for
  how migrations run); never point tests at the production DB. If no scratch
  DB is reachable, mock the pool and say clearly what ran vs. what didn't.
- Report honestly what you verified vs. inspected — e.g. Phase 1 noted "not
  run against the live DB" for the reprocess changes; keep that discipline.

## House rules (learned/confirmed across sessions)

- Never push, and don't force-push, without explicit permission. Commit only
  on natural wrap-up signals — otherwise leave work uncommitted for review.
- Don't relitigate ratified decisions; DO flag new evidence that contradicts
  them (that's how the store-as-INVALID decision got corrected).
- When your work changes the wire contract or the shared selection rules in
  any way, update `docs/HTTPS_INGEST_POLISH_PLAN.md` in BOTH repos (each has a
  cross-repo coordination section) and note it for the station side — the
  station's Phase 2/3 session will read that section first.
- Update the plan file's checkboxes with a short status note per item as you
  land them (Phase 1 sections in both repos show the format).
- The station repo's Phase-1 work is uncommitted pending Devon's review — if
  you need to read it, read it from the working tree there, not from its git
  history.

## Definition of done for this handoff

All Phase-2 and Phase-3 checkboxes in this repo's plan checked with status
notes; `tsc`/`lint`/`npm test` clean; golden-vector fixture committed and
passing; shared ingest core documented well enough that the station repo's
Phase 2 session can reference it; cross-repo coordination sections updated in
both plan files; nothing committed unless Devon gave a wrap-up signal.
