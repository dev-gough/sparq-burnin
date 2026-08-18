# Station Auto-Enrollment — Design & Plan (canonical)

**Status:** DRAFT for Devon/Thomas review — nothing implemented yet.
**Repos:** `burnin` (server, this doc is canonical) + `Zigbee_UART_Interface` (station; see
`STATION_ENROLLMENT_PLAN.md` at that repo root for the station work breakdown; base branch there is
`development`).
**Problem:** Manufacturing operators cannot be trusted to configure station credentials
(`station_id` / `hmac_secret`) by hand. Provisioning must require **zero input on the station PC**.

## 1. Approach (ratified direction)

Combined "bootstrap token + auto-enroll":

1. At **build time** we bake a revocable **bootstrap token** (and the production ingest URL) into the
   frozen station exe. Shipped `config.ini` defaults have **empty** `station_id` and `hmac_secret`.
2. On **first launch**, the station generates its own per-station HMAC secret, derives a
   `station_id` from machine identity, and POSTs an enrollment request to the dashboard,
   authenticated by the bootstrap token.
3. Server **auto-approves** new station_ids while the token is valid → station is live with a unique
   per-station secret, no human on either end. Conflicts (station_id already enrolled) and edge
   cases drop into a **pending-approval queue** in the existing `/stations` admin UI.
4. Per-station secrets move from `config.json` `ingest.stations` to a DB table; `config.json`
   remains as a legacy fallback so existing stations (`LabBurnIn-1`, lab) keep working untouched.

Trust anchors, explicitly: the shipped exe artifact (token), TLS to the production URL baked into
the build, and the `/stations` admin allowlist for anything the token can't auto-approve. A leaked
token lets an attacker enroll *new junk stations only* (visible in the UI, revocable, additive-only
ingest); it can never impersonate or displace an already-enrolled station (conflict → pending).

## 2. Wire contract — `POST /api/stations/v1/enroll`

Public route. **No middleware change needed**: `PUBLIC_PREFIXES` in `src/proxy.ts:18-24` already
covers `/api/stations/v1/` (and the matcher regex excludes it). Add pinning cases to
`tests/middleware.test.ts` so this stays true.

### Request

HMAC-signed **exactly like ingest** (reuse `verifyHmacCore` / station `sign_request`), with the
**bootstrap token secret as the HMAC key** and the *candidate* station_id in `X-Station-Id`.
This buys replay protection (nonce + skew), path pinning through the reverse proxy, and golden-vector
coverage for free.

Headers:

| Header | Value |
| --- | --- |
| `X-Station-Id` | candidate station_id |
| `X-Enroll-Token-Id` | public half of the bootstrap token — server uses it to look up the secret half |
| `X-Ingest-Timestamp` / `X-Ingest-Nonce` / `X-Ingest-Signature` | as per existing HMAC scheme; canonical path is `/api/stations/v1/enroll` |

Body (JSON, not gzipped — it's tiny):

```json
{
  "stationId": "MFG-LINE3PC-a4f2",
  "secret": "<64 hex chars, station-generated via secrets.token_hex(32)>",
  "fingerprint": {
    "hostname": "LINE3PC",
    "machineId": "<uuid.getnode() hex or Windows MachineGuid>",
    "os": "Windows-10-...",
    "appVersion": "x.y.z"
  }
}
```

The **station generates the secret** and durably persists it *before* sending (crash-safe, idempotent
retries, and the secret never has to travel in a response body). Token format:
`<token_id>.<token_secret>` — id is loggable/lookup-able, secret is the HMAC key.

### Responses

| Code | Meaning | Station behavior |
| --- | --- | --- |
| `201 {ok, stationId, status:"active"}` | Enrolled (or idempotent re-send of an already-active identical credential) | Persist to `config.ini`, rebuild clients, done |
| `202 {ok, stationId, status:"pending"}` | Valid token but station_id already has a *different* active credential → queued for admin approval | Re-POST same request on slow poll (e.g. 60 s) until 201 |
| `400 {error}` | Malformed body / bad stationId charset | Permanent; loud GUI error |
| `401 {error:"auth"}` | Unknown/expired/revoked token, bad signature, skew, replay | Permanent; loud GUI error ("contact SparQ") |
| `429 / 5xx / network` | Transient | Retry with backoff (existing formula) |

Idempotency rule (the whole flow keys off this): **if an active credential exists for
`stationId` and its secret equals the submitted secret → `201`**, always. So a station that missed
the ack, rebooted mid-enroll, or re-runs after approval converges by simply re-POSTing.

`404` from an old server (route not deployed yet) → station treats as transient-slow, since server
deploys first (§7) this only occurs in mis-sequenced rollouts.

## 3. Server design (burnin)

### 3.1 Schema — migration `017` (`station_enrollment`) in `scripts/migrate-db.ts`

Follow the existing inline-SQL idempotent pattern (`016` is current highest).

```sql
CREATE TABLE EnrollmentTokens (
  token_id     TEXT PRIMARY KEY,          -- short random id, embedded in exe alongside secret
  token_secret TEXT NOT NULL,             -- plaintext: it is an HMAC key, so the server must hold
                                          -- it (hashing would make verification impossible);
                                          -- revocation/expiry is the control, same as station secrets
  label        TEXT NOT NULL,             -- e.g. "MFG shipment 2026-09"
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  max_uses     INTEGER,                   -- NULL = unlimited while unexpired
  uses         INTEGER NOT NULL DEFAULT 0,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE StationCredentials (
  station_id   TEXT PRIMARY KEY,
  secret       TEXT NOT NULL,             -- plaintext by necessity: HMAC needs both sides; same
                                          -- trust level as today's config.json
  token_id     TEXT REFERENCES EnrollmentTokens(token_id),
  fingerprint  JSONB,
  enrolled_ip  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ                -- soft revoke; auth resolver skips revoked rows
);

CREATE TABLE StationEnrollments (          -- audit trail + pending queue
  id           BIGSERIAL PRIMARY KEY,
  station_id   TEXT NOT NULL,
  secret       TEXT NOT NULL,             -- candidate secret held here until decided
  token_id     TEXT REFERENCES EnrollmentTokens(token_id),
  fingerprint  JSONB,
  request_ip   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('auto_approved','pending','approved','rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ,
  decided_by   TEXT
);
CREATE UNIQUE INDEX uq_stationenrollments_pending
  ON StationEnrollments (station_id) WHERE status = 'pending';
```

The partial unique index makes repeated 202-retries idempotent (one pending row per station_id;
`ON CONFLICT DO NOTHING`, still answer 202). Approval upserts the pending row's secret into
`StationCredentials` and marks the row `approved`; the station's next retry then hits the
idempotency rule and gets its 201.

### 3.2 Enroll route — `src/app/api/stations/v1/enroll/route.ts`

Flow:

1. Read raw body (small hard cap, e.g. 8 KB).
2. Look up `X-Enroll-Token-Id` in `EnrollmentTokens`; reject 401 if missing/revoked/expired/uses
   exhausted. Verify the HMAC signature via the existing core using `token_secret` as the key.
3. Nonce replay: reuse `recordNonce()` (`src/lib/ingestAuth.ts:83-103`) with key
   `enroll:<token_id>:<nonce>`.
4. Validate body with zod: `stationId` `[A-Za-z0-9._-]{1,64}` and must equal `X-Station-Id`;
   `secret` exactly 64 lowercase hex; fingerprint keys optional strings.
5. Decide:
   - Active credential exists with same secret → `201` (idempotent), no new rows.
   - No credential (or only a revoked one) → insert `StationCredentials` + `StationEnrollments`
     row (`auto_approved`), bump `uses` → `201`.
   - Active credential with different secret → upsert pending `StationEnrollments` row → `202`.
6. Log every decision (`station_id`, token_id, ip, outcome) — this endpoint is the audit surface.

### 3.3 Secret resolution — DB-first with config fallback

Today: `getStation()` in `src/lib/ingest/stations.ts:85-89` is sync over `config.json`
(`ingest.stations`) with `INGEST_STATIONS_JSON` env override. Change:

- New `resolveStationSecret(stationId): Promise<StationConfig | undefined>` — query
  `StationCredentials` (skip `revoked_at IS NOT NULL`), fall back to the existing config/env path.
  DB-first so a rotation wins over a stale config entry.
- `verifyIngestRequest` (`src/lib/ingestAuth.ts:105-166`) is already async; widen its `getStation`
  param to accept `StationConfig | undefined | Promise<…>` and `await` it. Both callers switch:
  ingest route (`src/app/api/ingest/v1/tests/route.ts`) and policy route
  (`src/app/api/stations/v1/config/route.ts`).
- Cost: one extra indexed PK lookup per request, on routes that already do a DB round-trip for the
  nonce. No cache in v1; add a short-TTL cache later only if measured.
- `hasSecret` in `listStationControls()` (`src/lib/stationControls.ts:180-235`) must become
  config-OR-DB, and the station union should include `StationCredentials` rows so freshly enrolled
  stations appear in `/stations` immediately.

### 3.4 Admin surface (allowlist-gated via existing `requireStationAdminAuth`)

New API routes (all under the *protected* `/api/stations/` prefix — middleware already guards it):

| Route | Purpose |
| --- | --- |
| `GET /api/stations/enrollments` | List pending (+ recent decided) enrollment requests |
| `POST /api/stations/enrollments/[id]` | `{action: "approve" \| "reject"}` — approve upserts credential |
| `GET/POST /api/stations/tokens` | List tokens (id, label, expiry, uses — never the secret after creation) / mint one. Mint response shows `<id>.<secret>` **once**, for the build script |
| `DELETE /api/stations/tokens/[id]` | Revoke |
| `DELETE /api/stations/credentials/[id]` | Revoke a station credential (compromise response; replaces today's "edit config.json") |

`/stations` page (`src/app/stations/page.tsx`) gains three cards: **Pending enrollments**
(approve/reject with fingerprint + IP shown), **Bootstrap tokens** (mint/revoke), and per-station
**Revoke credential** on the existing rows. Existing 30 s poll covers refresh.

### 3.5 Enablement is unchanged

`StationControls` semantics stay exactly as ratified 2026-07-28: enablement gates test *starts*
only, no row = enabled, auth (now: credential existence/revocation) is the delivery gate. Enrollment
does **not** create a `StationControls` row.

## 4. Station design (zigbee — summary; details in that repo's plan)

- **Build baking:** new `build_release.py` mints/accepts a token, writes `burnin/bootstrap.json`
  (`{token_id, token_secret, enroll_url}`), adds it to the spec `datas`
  (`burnin/master_burnin.spec:19-25`), runs PyInstaller, deletes the file. Token lives inside the
  exe (`_MEIPASS`), not next to it — operators never see it. Shipped `defaults/config.ini` gets the
  production `url` and **empty** `station_id`/`hmac_secret`.
- **First-run flow** (slots between client construction at `burnin_master.py:603-604` and
  `_start_policy_worker()` at `:605`): if `hmac_secret` is empty and a bundled `bootstrap.json`
  exists → background enrollment worker: derive station_id
  (`MFG-<sanitized hostname>-<4-hex hash of machine id>` — hostname alone is unsafe, manufacturing
  clones images; machine id is **MAC-first**, see §4.1), generate secret, **atomic-write `enrollment_state.json` first** (reuse
  `atomic_write_bytes`), then POST/retry per §2. On 201: write `station_id` + `hmac_secret` into
  `config.ini` via config_manager, rebuild ingest/policy clients, start policy worker.
- **UX:** non-blocking (Tk stays responsive); readiness text blocks Start Test until enrolled
  ("Enrolling with dashboard…" / "Awaiting dashboard approval" / loud permanent-failure state via
  Thomas's status-surfacing path).
- **Optional hardening (phase-2):** bundle the server CA cert and pass `verify=<path>` to
  `requests` — TLS pinning with zero station input.

### 4.1 Machine-id derivation (RESOLVED 2026-08-18: MAC-first)

MachineGuid is OS state — cloned disk images (the expected manufacturing failure mode) share it,
which defeats the suffix entirely. The MAC is per-NIC hardware, unique across clones, and stable
across re-images (a re-imaged PC re-derives the same station_id → conflict → one admin click, and
its history stays attached). Derivation chain, in order:

1. `uuid.getnode()` — **guarded**: if the multicast/random bit is set (`(node >> 40) & 1 == 1`,
   per RFC 4122 §4.5 this means Python failed to find a hardware MAC and returned a *random*
   number that changes per process), the value MUST be discarded. Using it unguarded would derive
   a different station_id on every launch.
2. Fallback: Windows `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`).
3. Last resort: random id generated once and persisted in `enrollment_state.json` before use.

The suffix is collision-*avoidance*, not identity-proof: any residual failure (Wi-Fi MAC
randomization, USB NIC swapped between boots) degrades to a station_id conflict → pending queue →
admin click. Nothing at manufacturing ever needs operator input.

## 5. Threat model / accepted risks

| Threat | Answer |
| --- | --- |
| Token extracted from exe | Accepted. Blast radius = enrolling new junk stations while token is live; visible in `/stations`, token revocable, ingest is additive-only. Short expiry + optional `max_uses` shrink the window. |
| Token used to hijack existing station_id | Impossible by design — conflict → pending, human approves. |
| Enrollment replay / MITM | HMAC nonce+skew via existing core; TLS; path signed (proxy already proven to pass paths through). |
| Secrets plaintext in DB | Same posture as today's `config.json`; HMAC requires it. DB creds already gate everything else. |
| Enroll endpoint abuse (no token) | 401 with no rows written; per-token nonce namespace; small body cap; log + existing infra rate limiting. |
| Re-imaged PC (lost secret, same identity) | Re-enrolls → same station_id (machine-id-derived) with new secret → conflict → pending → one admin click. |

## 6. Test plan

- **Golden vectors:** add an `enroll` vector to `tests/fixtures/hmac_golden_vectors.json` — and its
  byte-identical twin in zigbee `tests/fixtures/` (the drift alarm). Path
  `/api/stations/v1/enroll`, token secret as key.
- **burnin (vitest):** enroll route — happy path, idempotent re-send, expired/revoked/exhausted
  token, bad signature, replayed nonce, conflict→202, pending-row idempotency, approve→201-on-retry;
  resolver — DB-first, config fallback, revoked skipped; middleware pinning — `/api/stations/v1/enroll`
  public, `/api/stations/enrollments` + `/api/stations/tokens` protected; admin routes with fake pg
  client (match `processPayload.test.ts` style).
- **zigbee (pytest):** enrollment state machine (fresh, crash-after-persist, 202 loop, 401
  permanent), station_id derivation/sanitization, config.ini write-back, golden vector signing.
- **Lab acceptance (extend `docs/LAB_TEST_PROCEDURE.md`):** LT-14 fresh-station happy path against
  labserver; LT-15 conflict → pending → approve in UI → station converges; LT-16 revoked token →
  loud GUI failure; LT-17 re-image re-enroll.

## 7. Rollout

1. **Server first** (safe: resolver falls back to config.json, existing stations unaffected):
   merge to burnin `master` → CI deploy runs `npm run migrate` (017) before restart, per the
   existing pipeline.
2. Mint a shipment token in `/stations` (label + expiry ≈ shipment window + slack).
3. Build the station exe with `build_release.py` (token + production URL baked), smoke-test one
   enrollment against labserver with a lab token, then ship.
4. Stations self-enroll on first launch at manufacturing. Watch `/stations` for the new rows.
5. Revoke the shipment token once the expected stations are enrolled (belt-and-braces on top of
   expiry).
6. Existing lab/legacy stations migrate opportunistically (or never — fallback is permanent until we
   choose to delete `ingest.stations` from config.json).

## 8. Open questions for Devon + Thomas

1. Token policy: expiry-only, or also `max_uses` ≈ expected station count per shipment?
2. `station_id` scheme: is `MFG-<hostname>-<hash4>` acceptable for dashboard display, or do we want
   a friendlier admin-assignable alias later?
3. ~~Machine-id source on Windows~~ **RESOLVED 2026-08-18: MAC-first** (Devon) — see §4.1;
   MachineGuid demoted to fallback because cloned images share it.
4. CA pinning in v1 or phase-2?
5. Do we want an automated rotation endpoint (station re-keys itself over its authenticated
   channel) in v1, or is revoke-and-re-enroll enough for now? (Plan assumes phase-2.)
