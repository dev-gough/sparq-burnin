# BurnIn Dashboard

**Manufacturing telemetry for inverter burn-in testing** — pass/fail volume, failure trends, annotations, and full test traces in one place.

Built for Sparq Systems manufacturing & engineering: open a shift, see what’s failing, drill into a unit, leave a note.

---

## Highlights

| | |
|---|---|
| **Command center home** | Volume chart, failure-rate strip, executive filters, soft-refresh table |
| **Test detail** | Dense metadata, multi-series charts, annotate-first failure workflow |
| **Station ingest** | HMAC-authenticated HTTPS push from burn-in stations (gzip JSON) |
| **Access control** | Microsoft Entra ID (Azure AD); `@sparqsys.com` only |
| **Ops ready** | Health probe, encrypted ops logs, migrations on deploy |

---

## Stack

```text
Next.js 16  ·  React 19  ·  TypeScript  ·  PostgreSQL
Auth.js (NextAuth v5) + Microsoft Entra ID
Apache ECharts  ·  TanStack Table  ·  shadcn/ui  ·  Tailwind CSS v4
```

---

## Quick start (local)

**Requirements:** Node.js 20+, PostgreSQL 14+

```bash
git clone <repository-url>
cd burnin          # or burnin-dashboard
npm install

cp .env.example .env.local
# set NEXTAUTH_SECRET, Azure AD vars, or SKIP_AUTH=true for local-only

cp config.template.json config.json
# fill database (+ optional ingest stations)

npm run setup-db   # schema
npm run migrate    # ledgered migrations
npm run dev        # http://localhost:3000
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (Turbopack) |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint |
| `npm run migrate` | Apply DB migrations |
| `npm run ingest` | Import CSVs from `data/to_process/` |
| `npm start` | Production server (port **9001**) |

> **Auth:** set `SKIP_AUTH=true` only on trusted local networks. Production uses Entra ID — see [`.env.example`](./.env.example).

---

## What you get in the UI

### Home
- **Summary + compare** — totals and period-over-period context  
- **Test volume** — pass/fail over time (bars → line when dense); filter-aware empty state  
- **Failure rate strip** — aligned buckets with the volume chart  
- **Find tests** — compact filters (status, annotations, firmware, custom date range with drag-select calendar)  
- **Table** — soft reload when ranges change; open any row for detail  

### Test page
- Header with serial, firmware, timing, result  
- Interactive parameter charts (fullscreen capable)  
- Annotations with shared vocabulary / quick options  

### Stations & ingest
- Stations admin (allowlisted) for remote enable/disable  
- `POST /api/ingest/v1/tests` — per-station HMAC, idempotent ACK  

---

## Repository layout

```text
src/           App Router UI, API routes, lib
scripts/       DB setup, migrations, ingest, deploy helpers
tests/         Vitest unit / route tests
docs/          Design notes, deploy, ingest API, lab procedures
public/        Static assets
config.template.json   Machine config shape (copy → config.json)
.env.example           Auth & ops env template
```

Machine-local (gitignored): `config.json`, `.env.local`, `data/`, `logs/`.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [`docs/README.md`](./docs/README.md) | Full doc index |
| [`docs/INGEST_API.md`](./docs/INGEST_API.md) | Station HTTPS ingest contract |
| [`docs/INGEST_PRODUCTION.md`](./docs/INGEST_PRODUCTION.md) | Production ingest rollout |
| [`docs/CI_DEPLOY.md`](./docs/CI_DEPLOY.md) | Lab CI + deploy pipeline |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Schema & CSV ingestion |
| [`docs/DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md) | Host deployment notes |
| [`docs/CLAUDE.md`](./docs/CLAUDE.md) | Agent / contributor project notes |

---

## Security notes (public repo)

- **Never commit** `.env.local`, `config.json`, station HMAC secrets, or client secrets.  
- Azure app registration: redirect URI, admin consent for Graph `User.Read`, and a live client secret (or cert) on the host.  
- Tenant policies may block new client secrets — exclude this app under **Entra → Application policies → Block password addition** if you need to rotate.  
- Ingest routes use **HMAC**, not browser sessions; keep station secrets out of the frontend.

---

## Support

Questions or access: **dgough@sparqsys.com**

---

<p align="center">
  <sub>Sparq Systems · Burn-in manufacturing software</sub>
</p>
