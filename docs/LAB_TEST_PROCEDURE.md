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
| LT-01 | Happy-path E2E + cross-pipeline dedup | 0 | PASS | |
| LT-02 | Data fidelity: HTTPS vs CSV | 0 | PASS | |
| LT-03 | Coordinator removed mid-test | 1 | PASS | auto-reconnect recovered cleanly |
| LT-03 | Coordinator removed mid-test auto=false| 1 | PASS | FATAL surfaced, test ended + uploaded |
| LT-04 | Power cut to station PC (3 windows) | 1 | PASS | (a) run resumed w/ original start; (b) outbox survived hard cut, redelivered; (c) mid-burst cut: 28 pre/9 post + 2 receipt-dedup duplicate:true — exactly-once held throughout |
| LT-05 | Very long duration test | 1 | | |
| LT-06 | Dashboard unreachable / backlog drain / GUI | 2 | | |
| LT-07 | Remote disable mid-test | 2 | | |
| LT-08 | Clock skew + wrong secret | 2 | | |
| LT-09 | Server deploy/restart mid-upload | 2 | | |
| LT-10 | RETEST multi-row results CSV | 2 | | |
| LT-11 | Nonce replay rejection | 2 | PASS | signed request replayed from labserver: 400 invalid_schema then 401 replay; nonce consumed pre-processing |
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
- **Timezone contract**: the station attaches its local UTC offset to every
  wire timestamp (`2026-07-28T12:25:36-04:00`); the server honors it, and only
  offset-less timestamps fall back to the Delhi (IST) assumption. Both repos
  must be at or past the timezone-fix commit. Verify with LT-01 step 3a below.
  NOTE: the legacy pCloud/watchdog CSV path still assumes Delhi wall clock —
  correct for production stations, but a LAB CSV twin ingests 9 h 30 m off
  (EDT read as IST) and therefore will NOT cross-pipeline dedup against the
  correct HTTPS row. In the lab, either disable pCloud sync for the lab
  station from the start, or expect (and clean up) offset duplicate rows with
  `source_file NOT LIKE 'https:%'`.
- pCloud FileSync ON (stays on until LT-13) — subject to the timezone note
  above; cross-pipeline dedup itself can only be truly exercised on a station
  whose wall clock is IST.
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
  SELECT * FROM IngestReceipts ORDER BY created_at DESC LIMIT 5;
  ```

- **Helper on the labserver**: `/home/server/bin/lab-ack-window.sh
  open|close|status|verify` — holds the ack window open (stops the dashboard;
  interactive sudo), restores it (passwordless restart + health check), and
  runs the DB exactly-once check. Used by LT-04/06/09.

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
As of 2026-07-28 the server never emits 403 (disable gates test starts, not
ingest) — the station keeps the 403 classification for older servers.

---

## Tier 0 — baseline

### LT-01 — Happy-path E2E + cross-pipeline dedup

**Purpose:** prove auth, ingest, storage, and CSV-overlap dedup in one pass.

1. Run one normal (short is fine) test to completion.
2. Watch the outbox entry: `pending` → `acked` within one retry interval.
3. Confirm the dashboard row exists with `source_file = 'https:<key>'`.
3a. **Timezone check**: with the dashboard timezone selector on Local Time,
   the test's start/end must match the station PC's wall clock (e.g. a test
   started 12:25 EDT shows 12:25 EDT — not 12:25 IST). In the DB,
   `start_time_utc` must equal station wall clock + 4 h (EDT).
4. Wait for pCloud/watchdog to deliver the same test's CSV (only if pCloud is
   left on — see the timezone note in Prerequisites).

**Expected:** the HTTPS row has correct times (step 3a). If pCloud is on, the
CSV twin will appear as a SECOND row 9 h 30 m earlier (legacy path assumes
Delhi) — this is the documented lab limitation, not a dedup bug; delete the
CSV twin. True cross-pipeline dedup is only verifiable on an IST station.
Annotations placed on the HTTPS test (add one) survive and stay linked.
**Fail signals:** HTTPS row times wrong under step 3a; outbox stuck
`pending`; 401/400 in meta.

### LT-02 — Data fidelity: HTTPS vs CSV (one-time)

**Purpose:** last chance to catch transport drift before trusting HTTPS.

1. Pick one completed test delivered via HTTPS (LT-01 works).
2. Temporarily move its CSV pair into `data/to_process/` on the labserver
   with the HTTPS row deleted in a scratch schema — OR simpler: diff
   field-by-field the HTTPS row/samples against the raw CSV values by eye
   for ~10 sample rows + the result row.

**Expected:** identical values: sample count, statuses, latch fields, failure
time/description, all numeric columns. `timestamp_utc` differs from the raw
CSV wall clock by exactly the station's UTC offset (lab EDT: +4 h; Delhi:
−5:30) — that constant shift is the conversion working. The station's written
CSV itself stays byte-identical to the legacy format (naive wall clock, no
offset — the offset exists only in the wire payload, so MES/pCloud consumers
are unaffected). **Fail signals:** a NON-constant timestamp shift or one that
isn't the station offset, null columns that the CSV populates, sample-count
mismatch.

---

## Tier 1 — hardware/power/time

### LT-03 — Coordinator removed mid-test

**Purpose:** the P1 fix for the silent-idle bug (slave used to idle forever
with reconnect disabled while the master never learned).

Run twice, once per `coordinator_auto_reconnect` setting. The key is
OPTIONAL and absent from config.ini by design — absence means `true`
(`burnin_slave.py` `_gateway_reconnect_enabled`, fallback=True). For the
disabled run, add `coordinator_auto_reconnect = false` to the `[Gateway]`
section of the station's config.ini and restart the app; delete the line
(or set true) to restore. Backoff knobs (also optional):
`coordinator_reconnect_initial_seconds` (2.0) /
`coordinator_reconnect_max_seconds` (60.0).

1. Start a test; a few minutes in, physically unplug the Zigbee coordinator.
2. Observe the slave and master UI.

**Expected (`auto_reconnect=false`):** slave emits a FATAL, stops, master
records the failure and ends the test; result uploads with the failure
description; dashboard shows the test with samples up to the rip point.
**Expected (`auto_reconnect=true`):** visible reconnect attempts as error
events, retrying indefinitely with backoff (2 s doubling to a 60 s cap —
this path never goes fatal by design). Re-plug the coordinator after a few
minutes: connection recovers and sampling resumes (gap in samples during
the outage is expected).
**Fail signals:** a worker that looks alive but never reports (the old bug);
test ends but never uploads; master UI unaware.

### LT-04 — Power cut to station PC

**Purpose:** durable-outbox guarantees AND the app's run-recovery feature
(`run_state.py` manifests + heartbeat + worker checkpoints: an unfinished run
resumes on relaunch with its ORIGINAL run_id, start time, and planned end —
the manifest deadline is authoritative). Recovery is exactly-once-friendly by
construction: the idempotency key derives from the manifest start time, which
survives the reboot. Three distinct cut windows:

- **(a) Mid-test:** cut power while a test runs. Expected: on boot +
  relaunch, the app detects the unfinished manifest and RESUMES the run —
  same run_id and start time, sampling gap during the outage — then runs to
  the original planned end, finalizes, and uploads ONE result whose
  dashboard row carries the original start time. If the PC comes back only
  AFTER the planned end passed: workers enter RECOVERING, wait out
  `[Reliability] recovery_reconnect_timeout_seconds` (default 300 s), then
  finalize AT the original deadline — the result is still written and
  uploaded, not lost. Any older unsent outbox entries drain normally too.
- **(b) Ack window (the critical one):** cut power right after a test
  completes (result enqueued, not yet acked). Expected: after boot the
  outbox resumes from meta files and redelivers with a fresh nonce; server
  dedups via idempotency key/receipt if it had already stored it. Exactly
  one dashboard row either way. No lost test. If the cut lands between
  result-write and manifest finalization, recovery may re-finalize and
  re-enqueue — same key (same serial + manifest start) → outbox/receipt
  dedup still yields exactly one row.
- **(c) Mid-write:** cut during heavy outbox/policy-cache writing. Expected:
  tmp files are discarded on scan; no crash, no corrupt meta aborting the
  outbox loop.

**Fail signals:** resumed run restarts the clock (new start time / new
idempotency key → would double-ingest); test present in outbox but never
delivered; duplicate rows; startup crash parsing a partial file or manifest.

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

**Purpose:** disable semantics = block *new* starts, never block data.

> **Semantics ratified mid-acceptance (2026-07-28):** the ingest endpoint no
> longer rejects disabled stations — "disabled" gates test STARTS only
> (server-side check removed; policy endpoint unchanged). Stations keep the
> 403-retryable classification for compatibility with older servers.

1. Start a test; disable `LabBurnIn-1` in `/stations` while it runs.
2. Confirm the readiness text shows the block (with the reason you set)
   within ~30 s. Let the test complete while disabled; try to start a new
   test → refused.
3. Re-enable.

**Expected:** running test completes and its upload is ACCEPTED while the
station is disabled — the batch appears on the dashboard normally; new test
starts blocked within ~30 s with an operator message carrying the disable
reason; after re-enable, Start Test unblocks within ~30 s. `/stations`
last-seen keeps updating throughout (polling continues while disabled).
**Fail signals:** upload rejected/held while disabled (old behavior); running
test killed by disable; station never notices re-enable; a new test starting
while disabled.

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
