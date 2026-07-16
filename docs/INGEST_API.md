# Burn-in HTTPS Ingest API (v1)

Source of truth for station → dashboard test delivery. Replaces pCloud + watchdog pairing for new stations.

## Overview

| Item | Value |
|------|--------|
| Endpoint | `POST /api/ingest/v1/tests` |
| Body | Gzip-compressed JSON (`Content-Encoding: gzip`) |
| Auth | Per-station HMAC (not Azure AD session) |
| Granularity | **One inverter / one completed test per request** |
| ACK | HTTP **200** only after durable Postgres commit |
| Idempotency | Client-supplied `idempotencyKey`; replays return the same `testId` |

Client outbox rule:

1. Write payload to local outbox **before** POST.
2. On **200** with `ok: true`, mark the outbox entry **acked** (eligible for cleanup).
3. Do **not** delete immediately; a separate cleanup job removes acked entries after retention.
4. Never mark acked on non-200.

## Authentication

### Headers

| Header | Description |
|--------|-------------|
| `X-Station-Id` | Station id (must match body `stationId` and a configured station) |
| `X-Ingest-Timestamp` | Unix time in seconds |
| `X-Ingest-Nonce` | Unique random hex string (replay protection) |
| `X-Ingest-Signature` | Hex HMAC-SHA256 of the canonical string |
| `Content-Type` | `application/json` |
| `Content-Encoding` | `gzip` |

### Canonical string (UTF-8)

```text
{timestamp}\n{nonce}\nPOST\n/api/ingest/v1/tests\n{stationId}\n{sha256_hex(raw_request_body)}
```

`raw_request_body` is the **gzip bytes** as received (hash the wire body, not the decompressed JSON).

```
signature = hex(HMAC-SHA256(station_secret, canonical))
```

### Clock skew

Default ±300 seconds (`INGEST_HMAC_SKEW_SEC`). Nonces are rejected if reused within a short TTL.

### Errors

| HTTP | `code` | Meaning |
|------|--------|---------|
| 401 | `auth` | Missing/invalid signature, skew, replay, unknown station |
| 403 | `station_disabled` | Station configured with `enabled: false` |
| 400 | `invalid_schema` | JSON/schema validation failed |
| 400 | `too_large` | Body or sample count exceeds limits |
| 400 | `station_mismatch` | Header station id ≠ body `stationId` |
| 500 | `server_error` | Unexpected server failure |

Error body shape:

```json
{ "ok": false, "code": "auth", "message": "…" }
```

## Request body (after gunzip)

```json
{
  "schemaVersion": 1,
  "stationId": "BurnInTest-1",
  "idempotencyKey": "BurnInTest-1:190825300020:2025-08-02T12:36:14",
  "submittedAt": "2026-07-16T12:00:00Z",
  "runId": "2025-08-02_12-36-14",
  "result": {
    "serialNumber": "190825300020",
    "startTime": "2025-08-02T12:36:14.000000",
    "endTime": "2025-08-03T12:36:14.000000",
    "firmwareVersion": "1.20.97",
    "productNumber": "sn-19",
    "criteriaProfile": "BurninCriteria:sn-19-v-94-97",
    "overallStatus": "FAIL",
    "acStatus": "FAIL",
    "ch1Status": "FAIL",
    "ch2Status": "PASS",
    "ch3Status": "PASS",
    "ch4Status": "PASS",
    "statusFlags": "…",
    "failureTime": "2025-08-02_12-40-00",
    "failureDescription": "…",
    "retestRecommended": "No"
  },
  "samples": [
    {
      "timestamp": "2025-08-02T12:36:20.123456",
      "vgrid": 230.1,
      "pgrid": 100.0,
      "qgrid": 0.0,
      "vpv1": 40.0,
      "ppv1": 25.0,
      "vpv2": null,
      "ppv2": null,
      "vpv3": null,
      "ppv3": null,
      "vpv4": null,
      "ppv4": null,
      "frequency": 50.0,
      "vbus": 400.0,
      "extstatus": 0,
      "status": 0,
      "temperature": 42.5,
      "epv1": 1.2,
      "epv2": null,
      "epv3": null,
      "epv4": null,
      "activeEnergy": 1.0,
      "reactiveEnergy": 0.0,
      "extstatusLatch": null,
      "statusLatch": null,
      "vgridInstLatch": null,
      "vntrlInstLatch": null,
      "igridInstLatch": null,
      "vbusInstLatch": null,
      "vpv1InstLatch": null,
      "ipv1InstLatch": null,
      "vpv2InstLatch": null,
      "ipv2InstLatch": null,
      "vpv3InstLatch": null,
      "ipv3InstLatch": null,
      "vpv4InstLatch": null,
      "ipv4InstLatch": null,
      "statusBits": "…"
    }
  ]
}
```

### Field rules

| Field | Required | Notes |
|-------|----------|--------|
| `schemaVersion` | yes | Must be `1` |
| `stationId` | yes | Must match `X-Station-Id` |
| `idempotencyKey` | yes | Stable across retries. Recommended: `{stationId}:{serialNumber}:{startTime to seconds}` |
| `submittedAt` | no | ISO UTC when station queued the upload |
| `runId` | no | Master run folder id (`YYYY-MM-DD_HH-MM-SS`) |
| `result.serialNumber` | yes | 12-digit string preferred |
| `result.startTime` / `endTime` | yes | ISO-like strings; **v1 treated as Asia/Kolkata (factory wall clock)** then stored UTC |
| `result.overallStatus` | yes | `PASS` \| `FAIL` \| `RETEST` \| `INVALID` (server may force `INVALID`) |
| `result.acStatus`, `ch1`…`ch4` | no | Channel pass/fail |
| `result.failureTime` | no | `YYYY-MM-DD_HH-MM-SS` or `N/A` / null |
| `samples` | yes | Array (may be empty); each needs `timestamp` |

Sample metric fields are optional nullables. Unknown keys are ignored by the server.

### Server-side status rules (same spirit as file ingest)

Applied after schema validation:

- Firmware equals configured debug version (`1.11.11` by default) → `overallStatus = INVALID`
- `startTime > endTime` → `INVALID`
- Duration &lt; 2 hours → `INVALID` (still ingested)

## Success response (200)

```json
{
  "ok": true,
  "testId": 12345,
  "idempotencyKey": "BurnInTest-1:190825300020:2025-08-02T12:36:14",
  "duplicate": false,
  "overallStatus": "FAIL",
  "stationId": "BurnInTest-1"
}
```

| Field | Meaning |
|-------|---------|
| `duplicate` | `true` if this `idempotencyKey` was already completed |
| `testId` | Dashboard `Tests.test_id` |

Client: treat **200 + `ok: true`** as ACK (including duplicates).

## Station configuration (server)

In `config.json`:

```json
"ingest": {
  "maxBodyBytes": 67108864,
  "maxSamples": 500000,
  "stations": {
    "BurnInTest-1": { "secret": "replace-me", "enabled": true },
    "BurnInTest-2": { "secret": "replace-me", "enabled": true }
  }
}
```

Disable a station (`enabled: false`) to stop accepting POSTs (403 `station_disabled`) without revoking the peer permanently.

## Deployment notes

- HTTPS in production.
- nginx: `client_max_body_size 64m;` (or higher).
- Proxy read/send timeouts ≥ 5–10 minutes for large COPY inserts.
- Middleware must allow `/api/ingest/*` without Azure session cookies.
- File-based `npm run ingest` remains for historical CSVs / reprocess only.

## Client mapping from burn-in CSVs

| Results CSV column | JSON field |
|--------------------|------------|
| Serial Number | `result.serialNumber` |
| Start Time | `result.startTime` |
| End Time | `result.endTime` |
| Inverter Firmware | `result.firmwareVersion` |
| Product Number | `result.productNumber` |
| Criteria Profile | `result.criteriaProfile` |
| Overall | `result.overallStatus` |
| AC | `result.acStatus` |
| CH1…CH4 | `result.ch1Status`… |
| Status Flags | `result.statusFlags` |
| Failure Time | `result.failureTime` |
| Failure Description | `result.failureDescription` |
| Retest Recommended | `result.retestRecommended` |

| Data CSV column | JSON sample field |
|-----------------|-------------------|
| Timestamp | `timestamp` |
| Vgrid | `vgrid` |
| Pgrid | `pgrid` |
| ActiveEnergy | `activeEnergy` |
| status_bits | `statusBits` |
| `*_inst_latch` | camelCase (`vgridInstLatch`, …) |

## Versioning

Breaking payload changes require `schemaVersion` bump and coordinated station release. Additive optional fields may land without a version bump.
