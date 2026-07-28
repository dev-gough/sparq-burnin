# HTTPS Ingest — Lab Test Procedure

Acceptance testing for the `feature/https-ingest` work (now on `master`),
running against the labserver dashboard (`http://192.168.20.12:9001`) and a
station on `Zigbee_UART_Interface` `feature/https-ingest`.

Scope: these cases test what the unit suites cannot — hardware failure, power
loss, long durations, and the seams between station ↔ server ↔ legacy pCloud
pipeline. The math (HMAC vectors, timestamp conversion, schema rejection,
gzip bombs, dedup logic) is already pinned by 70 vitest tests (server) and 75
pytest tests (station); do not re-test those by hand.

## Result tracking

| # | Case | Tier | Status | Notes |
|---|------|------|--------|-------|
| LT-01 | Happy-path E2E + cross-pipeline dedup | 0 | | |
| LT-02 | Data fidelity: HTTPS vs CSV | 0 | | |
| LT-03 | Coordinator removed mid-test | 1 | | |
| LT-04 | Power cut to station PC (3 windows) | 1 | | |
| LT-05 | Very long duration test | 1 | | |
| LT-06 | Dashboard unreachable / backlog drain / GUI | 2 | | |
| LT-07 | Remote disable mid-test | 2 | | |
| LT-08 | Clock skew + wrong secret | 2 | | |
| LT-09 | Server deploy/restart mid-upload | 2 | | |
| LT-10 | RETEST multi-row results CSV | 2 | | |
| LT-11 | Nonce replay rejection | 2 | | |
| LT-12 | `npm run reprocess` with HTTPS rows | 3 | | |
| LT-13 | pCloud FileSync cutover rehearsal | 3 | | |

Suggested order: 01 → 02, then Tier 1/2 in any order, Tier 3 last (12 and 13
only after everything else passes).

## Prerequisites (once)

- Station config `[DashboardIngest]`: `enable = true`,
  `station_id = LabBurnIn-1` (must match the server config key exactly),
  `url = http://192.168.20.12:9001` (explicit `http://`), `hmac_secret` =
  the `LabBurnIn-1` secret from the server's config.json.
- Station PC clock NTP-synced (HMAC skew window is ±300 s).
- pCloud FileSync ON (stays on until LT-13).
- For faster observation during failure cases, optionally shrink station
  knobs: `retry_interval_sec = 15`, `policy_stale_sec = 600`. Restore
  defaults afterwards.
- Before LT-12 only: `pg_dump burnin_dashboard > backup.sql` and
  `npm run backup-annotations` on the labserver.

## Verification toolbox

- **Dashboard**: main table (new tests appear); `/stations` (enable/disable,
  last-seen); test detail page (samples, failure description).
- **DB** (labserver, `~/burnin-dashboard`): HTTPS-delivered tests have
  `source_file LIKE 'https:%'`:

  ```sql
  SELECT test_id, overall_status, start_time_utc, source_file
  FROM Tests ORDER BY test_id DESC LIMIT 10;
  SELECT * FROM IngestReceipts ORDER BY received_at DESC LIMIT 5;
  ```

- **Station outbox** (`burnin/outbox/` on the station): one `*.json.gz` +
  `*.meta.json` per result. `meta.status` ∈ `pending` → `acked` (or
  `failed_permanent`); `attempts` / `next_attempt_at` show backoff.
- **Station log/GUI**: readiness text shows policy state and upload errors.
- **Server**: `journalctl -u burnin-dashboard` (needs sudo) or the Gitea
  Actions run log for deploys.

**Expected-status refresher.** A short test (< 2 h) stores as
`overallStatus = INVALID` ("Duration less than 2 hours") — batches of short
lab tests will be ALL INVALID and that is correct behavior, not a failure.
Server response classes the station acts on: 200 (ack, possibly
`duplicate:true`), 400 (permanent — payload dropped), 401/403 (long backoff +
operator alert, NOT dropped), 5xx/network (exponential backoff, NOT dropped).

---

## Tier 0 — baseline

### LT-01 — Happy-path E2E + cross-pipeline dedup

**Purpose:** prove auth, ingest, storage, and CSV-overlap dedup in one pass.

1. Run one normal (short is fine) test to completion.
2. Watch the outbox entry: `pending` → `acked` within one retry interval.
3. Confirm the dashboard row exists with `source_file = 'https:<key>'`.
4. Wait for pCloud/watchdog to deliver the same test's CSV.

**Expected:** exactly ONE Tests row for the test (CSV arrival logs a
duplicate-skip in the ingest log; no second row). Annotations placed on the
test (add one) survive and stay linked.
**Fail signals:** two rows for one physical test; outbox stuck `pending`;
401/400 in meta.

### LT-02 — Data fidelity: HTTPS vs CSV (one-time)

**Purpose:** last chance to catch transport drift before trusting HTTPS.

1. Pick one completed test delivered via HTTPS (LT-01 works).
2. Temporarily move its CSV pair into `data/to_process/` on the labserver
   with the HTTPS row deleted in a scratch schema — OR simpler: diff
   field-by-field the HTTPS row/samples against the raw CSV values by eye
   for ~10 sample rows + the result row.

**Expected:** identical values: sample count, `timestamp_utc` (Delhi−5:30),
statuses, latch fields, failure time. **Fail signals:** off-by-5:30 h
timestamps, null columns that the CSV populates, sample-count mismatch.

---

## Tier 1 — hardware/power/time

### LT-03 — Coordinator removed mid-test

**Purpose:** the P1 fix for the silent-idle bug (slave used to idle forever
with reconnect disabled while the master never learned).

Run twice, once per `coordinator_auto_reconnect` setting:

1. Start a test; a few minutes in, physically unplug the Zigbee coordinator.
2. Observe the slave and master UI.

**Expected (`auto_reconnect=false`):** slave emits a FATAL, stops, master
records the failure and ends the test; result uploads with the failure
description; dashboard shows the test with samples up to the rip point.
**Expected (`auto_reconnect=true`):** visible reconnect attempts; on
sustained failure, same terminal path (attempts exhausted → fatal).
**Fail signals:** a worker that looks alive but never reports (the old bug);
test ends but never uploads; master UI unaware.

### LT-04 — Power cut to station PC

**Purpose:** durable-outbox guarantees. Three distinct cut windows:

- **(a) Mid-test:** cut power while a test runs. Expected: in-flight test is
  lost (no result existed — acceptable and known); after boot the app starts
  clean and any older unsent outbox entries upload normally.
- **(b) Ack window (the critical one):** cut power right after a test
  completes (result enqueued, not yet acked). Expected: after boot the
  outbox resumes from meta files and redelivers with a fresh nonce; server
  dedups via idempotency key/receipt if it had already stored it. Exactly
  one dashboard row either way. No lost test.
- **(c) Mid-write:** cut during heavy outbox/policy-cache writing. Expected:
  tmp files are discarded on scan; no crash, no corrupt meta aborting the
  outbox loop.

**Fail signals:** test present in outbox but never delivered; duplicate rows;
startup crash parsing a partial file.

### LT-05 — Very long duration test

**Purpose:** size/time behavior no unit test touches.

1. Run a multi-day test (≥ 48 h; ideally spanning a month boundary).

**Expected:** upload completes within the 600 s timeout (payload of ~1450
rows/day gzips small — watch actual duration in the log); sample count and
timestamps correct end-to-end; station memory/file handles flat across days
(policy polls every 30 s for the whole run); dashboard chart renders the
large test acceptably (decimation kicks in).
**Fail signals:** upload timeout, creeping RSS on the station, wrong-day
timestamps at the boundary, dashboard chart unusable.

---

## Tier 2 — network, config, and operational failures

### LT-06 — Dashboard unreachable: backlog drain + GUI responsiveness

**Purpose:** closes the ONE unchecked acceptance box in the zigbee plan
(Tk responsiveness could not be verified headless).

1. Firewall or unplug the labserver for ≥ 1 h while the station completes
   1–2 tests (short tests fine).
2. Interact with the master GUI throughout: menus, readiness text, starting
   another test.

**Expected:** GUI stays responsive the entire time (network runs on the
worker thread); uploads back off exponentially to the cap; policy readiness
shows last-known state, then staleness once `policy_stale_sec` passes; on
reconnect, the whole backlog drains, every completed test appears exactly
once. **Then check the box in the zigbee repo's plan file with a note.**
**Fail signals:** frozen/laggy GUI (the pre-P1 behavior), lost or duplicated
backlog entries, station wedged in stale-policy state after reconnect.

### LT-07 — Remote disable mid-test

**Purpose:** disable semantics = block *new* starts, never lose data.

1. Start a test; disable `LabBurnIn-1` in `/stations` while it runs.
2. Let the test complete while disabled; try to start a new test.
3. Re-enable.

**Expected:** running test completes; its upload gets 403
`station_disabled` → polite backoff, entry stays retryable (NOT
`failed_permanent`); new test starts blocked within ~30 s with an operator
message; after re-enable the held result delivers on the next retry, and
Start Test unblocks within ~30 s.
**Fail signals:** payload dropped on 403; running test killed by disable;
station never notices re-enable.

### LT-08 — Clock skew + wrong secret

**Purpose:** the two realistic misconfigs; both map to 401 and must be LOUD
and recoverable, never a silent drop.

1. Set the station clock +10 min (disable NTP first). Run a short test.
2. Expected: upload 401 → prominent operator-visible error state, long
   backoff (`retry_backoff_max_sec`), payload retained. Fix the clock →
   delivered on next attempt (fresh nonce per attempt).
3. Repeat with a wrong `hmac_secret` (correct clock): same 401-class
   behavior; fix secret → delivery.

**Fail signals:** `failed_permanent` on 401; quiet retry loop the operator
can't see; no recovery after fixing the cause.

### LT-09 — Server deploy/restart mid-upload

**Purpose:** stations must ride through CI deploys; also exercises the
transient-5xx class against real infrastructure.

1. While a station is uploading (or has a pending backlog), push a trivial
   commit to master → the pipeline deploys and restarts the dashboard.

**Expected:** station sees connection errors/5xx during the restart window,
retries with backoff, delivers when the unit is back (health check in the
deploy proves the window is short). No `failed_permanent`, no duplicates
(idempotency covers a request that died after commit).
**Fail signals:** dropped payloads, doubled rows, deploy health check
failing while stations hammer.

### LT-10 — RETEST multi-row results CSV

**Purpose:** the P1 1.6 bug — station used to publish the FIRST row and the
idempotency key then blocked the correct one.

1. Produce a real fail → retest → pass sequence so the station's results CSV
   has multiple rows for the inverter.

**Expected:** the station uploads the same row the server-side rule would
pick (highest priority: valid > INVALID > short-duration > start>end; first
row wins ties), and the dashboard shows that row's status. The rule is
documented on `evaluateResultRow` in `src/lib/ingest/validate.ts`.
**Fail signals:** dashboard shows the wrong attempt; second (correct) row
rejected as duplicate.

### LT-11 — Nonce replay rejection (5 minutes, curl)

**Purpose:** confirm DB-backed replay protection on real infrastructure.

1. Capture one signed request (headers + body) from a station upload, or
   build one with the station's secret.
2. Send it twice within the 300 s window.

**Expected:** first → 200 (or 200 duplicate), second → 401
`Unauthorized (replay)`. A row for the nonce exists in `IngestNonces` and is
pruned after ~2× skew window.

---

## Tier 3 — operational rehearsals (after all above pass)

### LT-12 — `npm run reprocess` with HTTPS rows present

**Purpose:** first-ever live run of the P1 reprocess rewrite (verified by
reasoning only, until now). **Take the DB + annotations backup first.**

1. With ≥ a few HTTPS tests and ≥ one annotation on an HTTPS test in the DB,
   run `npm run reprocess` on the labserver.

**Expected:** HTTPS tests (`source_file LIKE 'https:%'`) and their samples
survive untouched; CSV tests are cleared and re-ingested; annotations
relink (HTTPS-test annotations keep `current_test_id`; CSV-test annotations
relink post-ingest); no sequence collisions (new test_ids don't collide with
surviving rows).
**Fail signals:** HTTPS rows gone (restore from backup, stop, report);
orphaned annotations; duplicate rows after re-ingest.

### LT-13 — pCloud FileSync cutover rehearsal

**Purpose:** rehearse the per-station cutover + rollback before production.

1. Preconditions: several confirmed HTTPS ingests from `LabBurnIn-1`
   (LT-01…09 provide these).
2. Disable pCloud FileSync for this station only. Run one test.

**Expected:** test arrives via HTTPS only; no CSV appears in
`data/to_process/`; dashboard row normal. Rollback = re-enable FileSync
(the dedup makes the overlap window safe in both directions).

---

## Wrap-up checklist

- [ ] All 13 cases recorded in the table above with pass/fail + notes.
- [ ] LT-06 result noted against the final unchecked acceptance box in
      `Zigbee_UART_Interface/HTTPS_INGEST_POLISH_PLAN.md` (item 1.3).
- [ ] Any station knobs shrunk for testing restored to defaults.
- [ ] Failures filed with: outbox meta JSON, station log excerpt, server
      response code, and the Tests/IngestReceipts rows involved.
