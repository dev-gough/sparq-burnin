# Documentation index

Internal and operational docs for the BurnIn Dashboard. The root [`README.md`](../README.md) is the public overview.

## Operations

| Document | Description |
|----------|-------------|
| [CI_DEPLOY.md](./CI_DEPLOY.md) | Gitea Actions, lab host deploy, migrations |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Host / production deployment |
| [CONFIG_SETUP.md](./CONFIG_SETUP.md) | `config.json` layout |
| [DATABASE.md](./DATABASE.md) | Schema and CSV ingestion |
| [INGEST_API.md](./INGEST_API.md) | Station → dashboard HTTPS ingest API |
| [INGEST_PRODUCTION.md](./INGEST_PRODUCTION.md) | Production ingest rollout |
| [LAB_TEST_PROCEDURE.md](./LAB_TEST_PROCEDURE.md) | Lab validation procedures |

## Product / engineering notes

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Dev commands, auth, architecture notes for agents |
| [ui-refresh-design.md](./ui-refresh-design.md) | Dashboard UI refresh design |
| [UI_UX_OPTIMIZATION_PLAN.md](./UI_UX_OPTIMIZATION_PLAN.md) | UX optimization plan |
| [HANDOFF.md](./HANDOFF.md) | HTTPS ingest phase handoff (fulfilled) |
| [HTTPS_INGEST_POLISH_PLAN.md](./HTTPS_INGEST_POLISH_PLAN.md) | Ingest polish plan (dashboard side) |
| [CHAOS_SOAK_PLAN.md](./CHAOS_SOAK_PLAN.md) | Soak / chaos testing plan |

## Performance & history

| Document | Description |
|----------|-------------|
| [BATCH_PREFETCH_INTEGRATION.md](./BATCH_PREFETCH_INTEGRATION.md) | Batch prefetch |
| [CLIENT_PROGRESSIVE_LOADING.md](./CLIENT_PROGRESSIVE_LOADING.md) | Progressive loading |
| [OPTIMIZATION_SUMMARY.md](./OPTIMIZATION_SUMMARY.md) | Optimization summary |
| [PROFILING.md](./PROFILING.md) | Profiling notes |
| [FAILURE_CLASSIFICATION_REPORT.md](./FAILURE_CLASSIFICATION_REPORT.md) | Failure classification (may be gitignored) |

## Archive

One-off exports and migration artifacts live under [`archive/`](./archive/). Prefer the database as the source of truth for annotations and test data.
