# HTTPS ingest — production checklist

API contract: [`INGEST_API.md`](./INGEST_API.md).

## Multi-station

| Rule | Detail |
|------|--------|
| Default: one `station_id` per physical PC | e.g. `BurnInTest-1`, `BurnInTest-2` |
| Unique HMAC secret per station | Revoke/disable one without touching others |
| Concurrent masters (different PCs) | OK — separate POSTs; `idempotencyKey` prevents dupes |
| Concurrent masters **on one PC** | See below — isolate config / outbox / paths |

## Multiple masters on one PC

The dashboard accepts parallel uploads fine. What breaks is **two processes sharing one config, outbox, run folder, or Zigbee stick**.

**Do not** launch two EXEs against the same default `config.ini` in one install folder.

### Per instance (required)

| Isolate | Example |
|---------|---------|
| Config file | `config_line1.ini`, `config_line2.ini` |
| Launch | `master_burnin.exe --config C:\BurnIn\line1\config.ini` |
| Zigbee / COM | Different `com_port` (or TCP) per instance — never share a coordinator |
| `tests_path` | `C:\BurnIn\line1\tests` vs `line2\tests` (avoids `test-YYYY-MM-DD_HH-MM-SS` clashes) |
| `outbox_dir` | `C:\BurnIn\line1\outbox` vs `line2\outbox` (**critical** — shared outbox races retries/meta) |

### `station_id` (strongly recommended)

Use a distinct id per instance so ops can filter/disable one line:

```ini
; line 1
station_id = BurnInTest-1-A
outbox_dir = C:\BurnIn\line1\outbox

; line 2
station_id = BurnInTest-1-B
outbox_dir = C:\BurnIn\line2\outbox
```

Server `config.json` must list both:

```json
"BurnInTest-1-A": { "secret": "...", "enabled": true },
"BurnInTest-1-B": { "secret": "...", "enabled": true }
```

Same secret for both is OK if the whole PC is trusted; separate secrets are better for revoke.

If you keep **one** `station_id` for the whole PC, still split **outbox**, **tests_path**, and **COM ports**. You only lose per-instance disable/identity in the dashboard.

### What does *not* need to change

- Ingest API / HTTPS contract  
- Idempotency (retries from either process are safe once keys differ by SN/start)  
- FileSync rules (still off for dashboard delivery)

## Server

- [ ] Deploy ingest code; app restarted
- [ ] `npm run migrate` (migration **010**: `IngestReceipts`, `station_id`, `idempotency_key`)
- [ ] `config.json` → `ingest.stations` with strong secrets, `enabled: true`
- [ ] HTTPS only for station URLs
- [ ] Reverse proxy: `client_max_body_size` ≥ **64m**; read/send timeouts ≥ **5–10 min**
- [ ] Disable a station: set `"enabled": false` (no redeploy required if config is re-read; otherwise restart)

Example:

```json
"ingest": {
  "maxBodyBytes": 67108864,
  "maxSamples": 500000,
  "stations": {
    "BurnInTest-1": { "secret": "<long-random>", "enabled": true },
    "BurnInTest-2": { "secret": "<long-random>", "enabled": true }
  }
}
```

## Station (master burn-in)

```ini
[DashboardIngest]
enable = True
station_id = BurnInTest-1
url = https://<host>/api/ingest/v1/tests
hmac_secret = <same as server>
outbox_dir = outbox

[FileSync]
enable_file_copy_to_folder = False
enable_file_upload = False
```

- [ ] URL path exactly `/api/ingest/v1/tests` (signed into HMAC)
- [ ] FileSync off (avoid dual-path with pCloud)
- [ ] NTP / reasonable clock (HMAC skew default ±5 min)
- [ ] Outbox dir writable; persists across restarts for retries

## Cutover

1. Pilot one station → confirm ACKs + dashboard rows with `station_id`
2. Enable remaining stations
3. Stop relying on pCloud/watchdog for those stations
4. Keep file `npm run ingest` only for historical backfill

## Morning / health checks

| Signal | Good |
|--------|------|
| Master log | `Dashboard ACK` + `testId` per SN |
| Outbox meta | `status=acked` (cleanup removes later) |
| DB / UI | Rows with `station_id`, samples present, PASS/FAIL for full runs |
| Short tests | May be `INVALID` on server (&lt; 2h rule) even if upload OK |

## Failure quick map

| Symptom | Check |
|---------|--------|
| Outbox `pending` + `lastError` | Network, URL, secret, 403 disabled, timeouts |
| 401 `auth` | Secret, path, clock skew, `station_id` mismatch |
| 403 `station_disabled` | Server `enabled: false` |
| No outbox files | `enable=False` or post-test path didn’t run |
| Duplicate 200 | Normal retry; same `testId` |

## Remote station enable/disable

Single flag: **`enabled`** (blocks Start Test on master + HTTPS ingest).

| Piece | Detail |
|-------|--------|
| Storage | Postgres `StationControls` |
| Admin UI | **Stations** sidebar tab (hidden unless allowlisted) |
| Admin auth | Entra session + `STATION_ADMIN_ALLOWLIST` (env, default `dgough@sparqsys.com`) |
| Station poll | `GET /api/stations/v1/config` (HMAC, empty body hash) |
| Offline | Cache last policy on disk; disabled stays disabled until re-enabled |
| `policy_stale_sec` | Master config (default 48h) — cache still applied; age for ops awareness |
| In progress | Disable does **not** force End Test |

Admin env:

```env
STATION_ADMIN_ALLOWLIST=dgough@sparqsys.com
```

## Explicitly out of v1

Shared nonce store for multi-node Next clusters, async job queue, full remote config (criteria/duration), force-end running tests.
