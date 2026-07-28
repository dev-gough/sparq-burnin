# Chaos Soak — Plan

Status: PLANNED (build after manual LT acceptance finishes).
Owner: Devon. Repos: `Zigbee_UART_Interface` (driver) + `burnin` (server-side
verify helpers).

## Why

The hardest LT cases (power cut in the ack window, connection death mid-POST,
deploy mid-upload) are timing windows a human can barely aim at, and they are
exactly the cases most likely to regress silently when the outbox/retry code
changes. A chaos soak converts that whole tier of manual testing into an
unattended loop: run N short tests overnight with a randomized fault schedule,
then let an invariant checker — not eyes — judge the outcome.

The unit suites (79 station / 79 server tests) already pin the *logic*. The
soak pins the *integration*: real process death, real network stack, real
server, real filesystem.

## Architecture

Two tiers, built in order:

### Tier A — delivery soak (the core; hardware-free)

The soak's real subject is the delivery pipeline (result → outbox → HTTPS →
DB), not the RF hardware. So drive it with **synthetic tests**:

- **Runner** (`tools/chaos_soak/runner.py`, zigbee repo): a small standalone
  process that, per iteration, writes a synthetic results/data CSV pair in the
  exact `logger.py` format (unique fake serial per iteration, e.g.
  `999<seed><n>`), then exercises the REAL `DashboardIngestClient`
  (`enqueue_from_result` → `process_pending`) against the REAL labserver
  dashboard. No Tk, no coordinators, seconds per iteration instead of
  minutes. Because the runner is a separate OS process that owns the outbox,
  `kill -9` on it is a faithful stand-in for power loss at the app level.
- **Fault injector** (same runner, seeded RNG): per iteration roll one of:
  - `none` — control iteration (must always pass).
  - `kill_after_enqueue` — SIGKILL the delivery subprocess right after the
    outbox body+meta land, before any POST (LT-04b's window, held open).
  - `kill_mid_post` — SIGKILL while the POST is in flight (LT-04c). Trigger
    via a `requests` response hook or by killing at a random 0–200 ms offset
    after upload start.
  - `server_restart_mid_upload` — `ssh labserver sudo -n systemctl restart
    burnin-dashboard` racing the upload (LT-09; sudoers already allows
    restart passwordless).
  - `server_down_long` — hold the dashboard unreachable for several
    iterations, then release (LT-06 backlog drain). Uses
    `lab-ack-window.sh open/close` (see below) or a station-side firewall
    rule.
  - `duplicate_replay` — re-send an already-acked body verbatim (LT-11's
    receipt/nonce seam, integration-level).
  After every fault, relaunch the delivery subprocess and let the outbox
  drain (bounded wait, shrunk `retry_interval_sec`).
- **Invariant checker** (end of run, and incrementally): for every synthetic
  test the run created —
  1. exactly one outbox meta, terminal state `acked` (never stuck `pending`,
     never unexplained `failed_permanent`);
  2. exactly one Tests row + one IngestReceipts row on the labserver
     (queried over ssh with the config.json DB creds);
  3. `start_time_utc` = synthetic wall clock adjusted by the runner host's
     UTC offset (timezone contract holds under chaos);
  4. no orphan receipts, no duplicate `(inv_id, start_time_utc)` rows;
  5. sample count in TestData matches the synthetic CSV.
- **Reproducibility**: one `--seed` drives the entire fault schedule; every
  iteration appends `{iter, fault, offsets, outcome}` to a JSONL artifact. A
  failing run is re-runnable exactly with the same seed.
- **Cleanup**: synthetic serials are prefixed (`999…`) so a teardown step can
  delete their Tests/TestData/IngestReceipts rows and outbox files, keeping
  the lab DB clean.

### Tier B — full-stack soak (optional, after Tier A finds nothing)

Same fault schedule, but the "iteration" is a real short test in the real
`master_burnin` app with hardware attached. Needs an auto-run hook: evaluate
`tools/stress_master_gui.py` / `tools/stress_lablinq_gui.py` as the driver
basis before writing anything new; otherwise add a config-gated
auto-start-loop test mode to the app. Faults are external only (process
SIGKILL, service restart, firewall) — no injection code in the production
app. This tier is what catches Tk-thread and worker-IPC interactions that
Tier A cannot.

Out of scope for both tiers: true mains power loss (filesystem journaling,
half-written files). If a corrupted outbox file ever shows up in the field,
add the smart-PDU tier from the LT-04 discussion; until then `atomic_write`
+ Tier A kill coverage is the accepted stand-in.

## Server-side helper (exists): `scripts/lab-ack-window.sh`

Installed on the labserver at `/home/server/bin/lab-ack-window.sh`. Used
manually during LT-04/06/09 now, and by the Tier A `server_down_long` fault
later:

- `open` — stop the dashboard (interactive sudo; sudoers has no `stop` rule)
  so completed tests pile up in the outbox as `pending`.
- `close` — bring it back via the passwordless `restart` rule, wait for
  active + health 200.
- `status` — unit state + health probe.
- `verify` — DB-side exactly-once check: recent HTTPS rows, receipts, and
  any duplicate `(inv_id, start_time_utc)` groups.

Optional sudoers line if prompt-free `open` is wanted later:
`server ALL=(root) NOPASSWD: /usr/bin/systemctl stop burnin-dashboard`

## Build order

1. Synthetic CSV generator + runner loop, `fault=none` only; invariant
   checker end-to-end against labserver. (This alone is a nightly E2E test.)
2. `kill_after_enqueue` + relaunch/drain logic.
3. `kill_mid_post` + `server_restart_mid_upload`.
4. `server_down_long` + `duplicate_replay`.
5. Seeded schedule + JSONL artifacts + cleanup; run 100+ iterations
   overnight; wire a `make soak` / README entry.
6. (Later, optional) Tier B driver evaluation.

Definition of done for Tier A: 200 seeded iterations across all faults with
zero invariant violations, runnable unattended from a dev box or the
labserver with one command.
