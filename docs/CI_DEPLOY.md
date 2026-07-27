# burnin-dashboard — CI / lab deploy

Automated pipeline (modeled on sparq-toolbox):

```text
git push origin master
  → Gitea Actions (typecheck + vitest on ubuntu-latest)
  → host deploy on labserver (label: labserver)
  → /home/server/bin/deploy-burnin-dashboard.sh
  → npm ci + build + npm run migrate + systemctl restart burnin-dashboard
  → health check on /api/health
```

Manual re-runs of the pipeline (always deploys **master**): trigger
**workflow_dispatch** in the Gitea Actions UI. Gitea 1.22 does not support
`workflow_dispatch` input forms — if you add inputs, `DetectWorkflows`
rejects the whole file (`unknown on type`) and no runs are created.

Non-master lab deploys (e.g. `feature/https-ingest` during lab-test): run the
deploy script on the host with `BRANCH` set (see Manual deploy below).

## Database migrations

`npm run migrate` (`scripts/migrate-db.ts`) applies its built-in migration
list exactly once, recorded in a `migrations` ledger table that it creates on
first run. Every migration is also internally idempotent (guarded DO blocks),
so unlike sparq-toolbox there is **no baseline step** — it is safe on a DB
that was migrated by hand up to now.

The deploy script runs migrations **before** the restart deliberately: the
HTTPS ingest auth fails closed without migration 014 (`IngestNonces`), so new
code must never serve station traffic against an unmigrated DB. A failing
migration aborts the deploy and the old build keeps running.

## Lab host prerequisites

1. **Gitea Actions + act_runner** — already in place for sparq-toolbox
   (labels `ubuntu-latest` and `labserver:host`); enable Actions on the
   `burnin-dashboard` repo in Gitea (Settings → Repository → Actions).
2. **App checkout** at `/home/server/burnin-dashboard` with `origin` → the
   Gitea remote (`git.labserver.local:devy/burnin-dashboard.git`).
3. **config.json present** in the checkout (gitignored; copy structure from
   `config.template.json`). Must include the `database`, `ingest` (station
   secrets), and `auth` (allowlists) sections. `git reset --hard` never
   touches ignored files, so config.json, `.env.local`, `data/`, and `logs/`
   survive deploys. The deploy script refuses to run without it.
4. **systemd unit** `burnin-dashboard` that runs `npm start` (port 9001) in
   the checkout as the `server` user.
5. **Deploy script** installed:

   ```bash
   install -m 755 scripts/deploy-burnin-dashboard.sh /home/server/bin/deploy-burnin-dashboard.sh
   ```

6. **Passwordless sudo** for the `server` user (exact path
   `/usr/bin/systemctl`):

   ```sudoers
   server ALL=(root) NOPASSWD: /usr/bin/systemctl restart burnin-dashboard
   server ALL=(root) NOPASSWD: /usr/bin/systemctl is-active burnin-dashboard
   server ALL=(root) NOPASSWD: /usr/bin/systemctl status burnin-dashboard
   ```

   Verify: `sudo -n /usr/bin/systemctl is-active burnin-dashboard`

7. **Health token (optional)**: if the unit sets `HEALTH_TOKEN`, export the
   same value to the deploy script (e.g. in the runner's env or a wrapper) so
   its `/api/health` check sends the `x-health-token` header.

## Manual deploy

```bash
/home/server/bin/deploy-burnin-dashboard.sh                      # master
BRANCH=feature/https-ingest /home/server/bin/deploy-burnin-dashboard.sh
```

## Overridable environment

`APP_DIR`, `UNIT`, `BRANCH`, `NODE_BIN_DIR`, `HEALTH_URL`, `HEALTH_TOKEN`,
`HEALTH_RETRIES`, `HEALTH_SLEEP_SEC` — defaults at the top of
[`scripts/deploy-burnin-dashboard.sh`](../scripts/deploy-burnin-dashboard.sh).

## Workflow source

See [`.gitea/workflows/ci-deploy.yml`](../.gitea/workflows/ci-deploy.yml).
