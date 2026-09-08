# Documentation index

Internal and operational docs for the BurnIn Dashboard. The root [`README.md`](../README.md) is the public overview.

Lab-only runbooks, handoffs, and data dumps live under [`archive/`](./archive/) (gitignored — not published). Prefer the database as the source of truth for annotations and test data.

## Operations

| Document | Description |
|----------|-------------|
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Host / production deployment |
| [CONFIG_SETUP.md](./CONFIG_SETUP.md) | `config.json` layout |
| [DATABASE.md](./DATABASE.md) | Schema and CSV ingestion |
| [INGEST_API.md](./INGEST_API.md) | Station → dashboard HTTPS ingest API |
| [INGEST_PRODUCTION.md](./INGEST_PRODUCTION.md) | Production ingest rollout |
| [MANAGED_PROVISIONING_SERVER_PLAN.md](./MANAGED_PROVISIONING_SERVER_PLAN.md) | Server-assigned station identity implementation handoff |

## Product / engineering notes

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Dev commands, auth, architecture notes for agents |
| [TODO.md](./TODO.md) | Follow-ups not in an active plan (e.g. gradual station software-update policy) |
| [UI_UX_OPTIMIZATION_PLAN.md](./UI_UX_OPTIMIZATION_PLAN.md) | UX optimization checklist (largely implemented) |

## Performance

| Document | Description |
|----------|-------------|
| [BATCH_PREFETCH_INTEGRATION.md](./BATCH_PREFETCH_INTEGRATION.md) | Batch prefetch |
| [CLIENT_PROGRESSIVE_LOADING.md](./CLIENT_PROGRESSIVE_LOADING.md) | Progressive loading |
| [OPTIMIZATION_SUMMARY.md](./OPTIMIZATION_SUMMARY.md) | Optimization summary |
| [PROFILING.md](./PROFILING.md) | Profiling notes |
