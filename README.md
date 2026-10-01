# BurnIn Dashboard

Manufacturing record for Sparq inverter burn-in. A completed run is one row in `Tests` (serial, firmware, start and end, verdict, station or source file) plus the sampled electrical trace in `TestData`. The browser app is how engineering reviews those runs, classifies failures, and operates the stations that produce them.

New stations submit a finished test with `POST /api/ingest/v1/tests`: gzip JSON, one inverter per request, per-station HMAC, and an ack only after Postgres commits. Older runs still arrive as paired CSVs (`results` plus `tests`) copied off the file share and loaded by `npm run ingest`.

People sign in with Microsoft Entra ID. Accounts outside `@sparqsys.com` are rejected. Ingest and the station policy poll do not use that session; they use HMAC.

## Dashboard (`/`)

The period is 7 days, 30 days, 90 days, all time, or a custom UTC range. Failure Analytics uses the same period, and the choice is stored so the next visit does not flash back to the default. Two populations are available: every decisive run, or the latest `PASS`/`FAIL` per serial.

`INVALID` and `RETEST` stay in the database and can be shown in the table. Rates, summary totals, the volume chart, and latest-per-serial selection ignore them. A `RETEST` is expected to be followed by a later decisive run.

The page has four working areas:

- Summary totals for the period, with the previous window of the same length.
- Pass/fail volume by bucket, and a failure-rate strip on the same buckets. Clicking the plot sets the table dates. Settings can omit calendar days that had no tests.
- Failure causes for the active category and station filters.
- The test table. Filters are serial (`*` is a wildcard), verdict, annotation category (including any tagged test), firmware, station, and a date range that can follow the dashboard or be set on its own. Columns are serial, that serial's test sequence (`2 of 3` across all dates and verdicts), firmware, start time in the selected timezone, duration against the 2 hour aging target, verdict, and annotation shorthand. The badge tooltip has the full category name and group. A row opens the test.

## Test record (`/test/[id]`)

The header carries the run metadata. Samples can be downloaded as CSV. The verdict can be overridden; each change is stored and listed in the status history with the author.

The trace is plotted from `TestData`. Series are grouped:

| Group | Channels |
|---|---|
| Power Generation | `vpv1`–`vpv4`, `ppv1`–`ppv4` |
| Energy & Efficiency | `epv1`–`epv4`, active and reactive energy |
| Grid Connection | `vgrid`, `pgrid`, `qgrid`, `vbus`, `frequency` |
| Current Latch | Instantaneous PV, grid, and neutral current latches |
| Voltage Latch | Instantaneous grid, bus, and PV voltage latches |
| System Status | Temperature, status, and extended-status words, plus their latches |

Presets select common combinations. Fullscreen keeps the current series, zoom, and decimation. Decimation holds a zoomed view near 1000 points so a long run stays responsive; it can be switched off per browser.

Annotations are written on this page. A category belongs to a group (manufacturing defect or setup issue) and the group carries a color. The signed-in email is stored as the author. The dashboard shows a short label; the stored name is the original category text, including free-text notes that are not in the vocabulary.

## Failure analytics (`/failure-analytics`)

Same period and latest-versus-all choice as the dashboard. Buckets are UTC.

- Failure rate, test count, failed-test count, and annotation coverage. Untagged failures link to the review queue.
- Failure rate by calendar bucket, with a moving average weighted by test volume, or by a rolling window of 10, 25, 50, 100, 250, 500, 1000, or 2000 tests in chronological order.
- Pass and fail volume for the same buckets.
- Stacked history by annotation category and by group. Grouping is daily, weekly, biweekly, monthly, or quarterly, and it applies to the rate chart and both histories.
- Pie labels can be a share of all tests or of failed tests. The slice sizes stay the same.

## Review queue and contributors

`/todo` is the list of failed tests with no annotation. It filters by serial, firmware, and date, and opens the test record.

`/contributors` is the annotation ledger by person: tests covered, share of failed tests, groups and categories used, and daily activity.

## Stations (`/stations`)

Shown to addresses on the station-admin allowlist. With `SKIP_AUTH=true` the check is skipped, which is for a trusted local machine.

- Enable or disable a station. Disable blocks Start Test on the burn-in PC and rejects HTTPS ingest. A test already running is not stopped. The PC polls `GET /api/stations/v1/config` over HMAC and caches the last policy, so a disable still holds while the PC is offline.
- A local display name, and a way to hide a station that should drop out of the list.
- Counts for that station: verdicts, unique serials, tests in the last 24 hours and 7 days, first and last ingest.
- Bootstrap tokens for a new install. The `<id>.<secret>` value is returned once. A token can expire, can have a use limit, and can be revoked.
- Enrollment. A first install can be given a server-owned station id. A re-image or a candidate collision against an id that already has a credential becomes a pending rotation; approving it rotates the HMAC secret on that id. A rejected request is not queued again. Credentials can also be revoked directly.

After enrollment, the live HMAC secret is in Postgres. `config.json` `ingest.stations` is the legacy map for stations that were configured before enrollment.

## Settings (`/settings`)

Theme (light, dark, or system), whether the sidebar opens on hover or on click, and whether dashboard charts drop empty days.

Annotation backup downloads `TestAnnotations` as CSV. Restore inserts rows that are not already present, matched on serial, start time, and type. It does not overwrite. Restore is limited to the restore allowlist.

## Data

PostgreSQL. The default database name is `burnin_dashboard`.

| Table | Contents |
|---|---|
| `Inverters` | Serial number |
| `Tests` | One completed run: timing, firmware, verdict, failure text, source file, station id, idempotency key |
| `TestData` | Samples for that run |
| `TestAnnotations` | Notes on a run, joined to the vocabulary when the text matches |
| `AnnotationGroups`, `AnnotationQuickOptions` | Group name, color, and the category list |
| `StationControls` | Enabled flag, reason, revision, display name, hidden |
| Station credentials, enrollment tokens, enrollment requests | HMAC identity and the approval queue |
| `IngestNonces` | Replay protection shared across processes |

Verdicts are `PASS`, `FAIL`, `INVALID`, and `RETEST`, and the column is `VARCHAR(10)`. Ingest stores the station or CSV verdict. The only rewrite is an unparseable timestamp, which becomes `INVALID`. A results file with several rows for one physical test keeps a single row: a decisive verdict beats `INVALID`, and a start time after the end time loses to any other row. The station client mirrors that priority so it uploads the row the server would have kept.

Offset-less timestamps are Asia/Kolkata wall clock, which is what the legacy CSVs contain. A timestamp that carries an offset keeps that offset. Values are stored as `timestamptz`. Dashboard and analytics filters use UTC dates. The table and test page render times in the timezone selected in the header.

The base schema is `scripts/setup-database.sql`. Later changes are ledgered SQL migrations applied by `npm run migrate`.

## Ingest

### HTTPS

`POST /api/ingest/v1/tests`

- Gzip JSON. One inverter, one completed test.
- Headers `X-Station-Id`, `X-Ingest-Timestamp` (unix seconds), `X-Ingest-Nonce`, and `X-Ingest-Signature` (hex HMAC-SHA256). The canonical string hashes the gzip bytes on the wire, not the decompressed JSON.
- Default clock skew is ±300 seconds. A `(timestamp, nonce, signature)` triple is accepted once. Nonces live in Postgres, so replay protection holds across workers and restarts. Signature checks run before the nonce is claimed. If the nonce store is unreachable the route returns 500 and the station retries.
- HTTP 200 only after the test and its samples commit. The body includes `testId`. The same `idempotencyKey` returns that id and does not insert a second run.
- 401 bad signature, skew, replay, or unknown station. 400 schema, size, or station-id mismatch. 403 station disabled. Default limits are 64 MiB and 500,000 samples.

The station writes the payload to a local outbox before the POST and marks it acked only on 200. The canonical string, body schema, and error codes are in [docs/INGEST_API.md](docs/INGEST_API.md). Cutover, the policy poll, and the outbox rules are in [docs/INGEST_PRODUCTION.md](docs/INGEST_PRODUCTION.md).

### CSV

`scripts/watchdog.py` watches `paths.source_directories` in `config.json`, copies new results and test CSVs into `data/to_process/`, and `npm run ingest` loads them. Files that load successfully move to `data/processed/`. This path is how historical pCloud data gets in. Stations that have moved to HTTPS should not also be ingested from the share.

Files that never pair, or that are already in `Tests.source_file`, sit in `to_process` until they are moved. `scripts/report-unprocessed-queue.py` lists them and does not write anything. `scripts/quarantine-ingest-queue.py` moves them to `data/quarantine/` and does not touch the database. `scripts/split-unprocessed-queue.py` splits a report into quarantine and pairs that can still be ingested. Watchdog treats `processed/` and `quarantine/` as already seen.

`npm run reprocess` drops loaded test data and reads `data/processed/` again. Use it when the loader changes.

## Operations

`GET /api/health` checks Postgres, auth configuration, the data directories, ingest and watchdog status files, the CSV queue and its lock, source freshness, the station fleet, the untagged-failure count, and disk capacity. If `HEALTH_TOKEN` is set, the caller must send `X-Health-Token`. The SPARQ Toolbox control center polls this route.

Application and Next.js log lines can be encrypted at rest with `LOG_ENCRYPTION_KEY`. `GET /api/ops/logs` and `GET /api/ops/log-files` export them under a separate HMAC (`OPS_HMAC_SECRET`). The variables are in `.env.example`.

`npm start` listens on port 9001. Host setup is in [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

## Local setup

Node.js 20 or newer. PostgreSQL 14 or newer.

```bash
git clone <repository-url>
cd burnin
npm install

cp .env.example .env.local
cp config.template.json config.json
```

Put the database connection in `config.json`. Add source paths if you are loading CSVs. For a local UI without Entra, set `SKIP_AUTH=true` in `.env.local`. That also opens Stations. Use it on a trusted machine, not on a host that is reachable outside the lab.

```bash
npm run setup-db    # create the database and base schema
npm run migrate     # ledgered migrations
npm run dev         # http://localhost:3000
```

`NEXTAUTH_SECRET` is `openssl rand -base64 32`. The Entra app registration, redirect URIs, and domain check are in [docs/CLAUDE.md](docs/CLAUDE.md) and `.env.example`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Production server on port 9001 |
| `npm test` | Vitest. Covers ingest, enrollment, HMAC vectors, stats, and the dashboard period model |
| `npm run lint` | ESLint |
| `npm run setup-db` | `scripts/setup.sh` |
| `npm run db:schema` | Reapply `scripts/setup-database.sql` to `burnin_dashboard` |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run ingest` | Load CSVs from `data/to_process/` |
| `npm run reprocess` | Reload from `data/processed/` |
| `npm run ingest-csv-annotations` | Load a historical annotation CSV |
| `npm run backup-annotations` | Dump `TestAnnotations` to CSV |
| `npm run migrate:annotations` | Annotation migration helper |
| `npm run clean` | Remove rows tagged with the debug firmware version from config |

Python helpers run from the repo root and read `config.json`.

| Script | What it does |
|---|---|
| `scripts/watchdog.py` | Copy new CSVs from the configured sources into `data/to_process/` |
| `scripts/report-unprocessed-queue.py` | Read-only list of leftover CSVs |
| `scripts/quarantine-ingest-queue.py` | Move leftover queue files to `data/quarantine/` |
| `scripts/split-unprocessed-queue.py` | Split a leftover report into quarantine and recoverable pairs |

## Configuration

Both copies are gitignored.

`.env.local` holds Entra, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `SKIP_AUTH`, the health and ops-log secrets, and optional ingest limit overrides. Template: `.env.example`.

`config.json` holds the database connection, CSV source paths, legacy per-station HMAC secrets, and the auth allowlists. Template: `config.template.json`. Field notes: [docs/CONFIG_SETUP.md](docs/CONFIG_SETUP.md).

`STATION_ADMIN_ALLOWLIST` and `RESTORE_ALLOWLIST` override `config.json` `auth.station_admin_allowlist` and `auth.restore_allowlist`. Values are comma-separated emails. An empty allowlist means nobody passes.

## Layout

```text
src/app/            App Router pages and API routes
src/components/     Dashboard, table, charts, stations UI
src/lib/            Ingest, stats, auth, stations, health
src/contexts/       Timezone, settings, annotation and test-data caches
scripts/            Schema, migrations, CSV ingest, watchdog, queue tools
tests/              Vitest
docs/               API contract, deployment, schema, operations
public/             Static assets
```

Machine-local and gitignored: `config.json`, `.env.local`, `data/`, `logs/`.

## Documentation

| Document | Subject |
|---|---|
| [docs/README.md](docs/README.md) | Index of the docs directory |
| [docs/INGEST_API.md](docs/INGEST_API.md) | HTTPS ingest contract |
| [docs/INGEST_PRODUCTION.md](docs/INGEST_PRODUCTION.md) | Rollout, policy poll, nonce store |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema and CSV ingestion |
| [docs/CONFIG_SETUP.md](docs/CONFIG_SETUP.md) | `config.json` |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Host deployment |
| [docs/MANAGED_PROVISIONING_SERVER_PLAN.md](docs/MANAGED_PROVISIONING_SERVER_PLAN.md) | Server-assigned station identity |
| [docs/CLAUDE.md](docs/CLAUDE.md) | Dev commands, auth setup, architecture notes |

## Security

Do not commit `.env.local`, `config.json`, station HMAC secrets, Entra client secrets, or log encryption keys.

Ingest secrets never go to the browser. The Stations page shows a bootstrap token once, at mint time, and credential reads do not return the secret.

Entra needs the redirect URI for this host, admin consent for Graph `User.Read`, and a current client secret or certificate. If the tenant policy blocks new client secrets, that app has to be excluded under Entra application policies before the secret can be rotated.

Questions about access: dgough@sparqsys.com
