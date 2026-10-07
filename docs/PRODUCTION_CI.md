# Manual production deployment

Gitea continues to test and deploy the lab checkout. GitHub's **Deploy production**
workflow is manual-only: pushing a commit or tag never starts a production deploy.
Production communicates outbound with GitHub; it does not access Gitea.

## Release and deploy

1. Follow the release/version rules in [CLAUDE.md](CLAUDE.md). Publish `master`
   and an annotated `vX.Y.Z` tag to the `github` remote.
2. On GitHub, open **Actions → Deploy production → Run workflow**.
3. Leave the workflow branch on **master**, enter the release tag, and run it.
4. Check the run's **Check release** and **Build and deploy checked release** jobs.

The first job runs on GitHub infrastructure with Node 24.11.1. It requires an
annotated tag on master whose name matches `package.json`, resolves its exact
commit, and runs lint, TypeScript checks, and tests. Only that commit is sent to
the production runner. A moved tag or a version mismatch stops the deployment.

The production job runs the installed `/home/devon/bin/deploy-burnin-production.sh`.
It builds in `/home/devon/sparq-burnin-production/releases/`, using private copies
of the original checkout's `config.json` and production environment files
(`.env.production.local`, `.env.local`, `.env.production`, and `.env` when present).
After building, it links those files, data, and log directories to the original
checkout for runtime use. Keeping shared symlinks out of the build prevents
Turbopack from tracing log links outside the release directory.

The script checks Python syntax and the watchdog's `psutil` dependency, then
stops the watchdog before `npm run migrate`. A live ingestion lock causes the
deployment to stop before interrupting ingestion; retry after that job finishes.
The watchdog handles termination by completing its current cycle, with systemd
allowing up to 30 minutes before forcing shutdown.

Deployment atomically switches `current`, restarts the dashboard, checks its
release version and database health, and starts the watchdog from that same
release. It verifies the watchdog's reported process ID and release directory.
Build failures leave both running services alone. Migration failures restart
the old watchdog. Failed activation restores the previous release and restarts
both services; database migrations remain applied.

The watchdog receives `BURNIN_RELEASE_DIR` from systemd and resolves it once at
startup, so cleanup and CSV ingestion use its own release's Node dependencies
and scripts. Other installations without this override retain the configured
`dashboard_dir`. The original checkout remains the shared data/configuration
location and Git cache; production no longer needs its code updated separately.

Database migrations remain applied after application rollback. New migrations
must be compatible with the previous application version. Release directories
are retained for inspection and rollback; remove obsolete releases manually
after confirming they are not `current` or your intended rollback target.

## One-time setup

The production service currently runs as `devon`, from `/home/devon/sparq-burnin`,
using `/home/devon/.nvm/versions/node/v24.11.1/bin/npm`. The setup below preserves
that checkout for shared data and configuration.

Install the two scripts on the server as `devon`:

```bash
mkdir -p /home/devon/bin
install -m 755 scripts/deploy-burnin-production.sh /home/devon/bin/deploy-burnin-production.sh
install -m 755 scripts/setup-production-service.sh /home/devon/bin/setup-production-service.sh
```

In the GitHub repository's **Settings → Actions → Runners → New self-hosted
runner**, select Linux/x64. Download and verify the official runner archive,
extract it into `/home/devon/actions-runner`, and run the displayed registration
command as `devon`. Give it the name `burnin-production` and the custom label
`burnin-production`. Do not copy a long-lived GitHub administrator token to the
server; the registration token expires after one hour.

From the production server, perform the one-time privileged setup:

```bash
sudo bash /home/devon/bin/setup-production-service.sh
```

This creates the release directories and a `current` link when needed, adds
systemd overrides so both services use that link, and grants `devon` passwordless
permission for **only** dashboard restart and watchdog stop/start. It also
installs and starts the registered runner as a service. It reloads systemd but
does not restart either application service or deploy a release. Rerunning it
is supported. Existing installations must rerun this setup before deploying
the first release with watchdog integration (v0.9.3 or later).

On GitHub, create a **production** environment and restrict deployment branches
to **master**. Use required reviewers if a second approval is wanted. Keep the
self-hosted job limited to this manual workflow; PR checks run on GitHub-hosted
machines, not the production server.

## Verification and maintenance

```bash
systemctl show burnin-dashboard.service -p WorkingDirectory
systemctl show burnin-watchdog.service -p WorkingDirectory -p ExecStart -p Environment
sudo systemctl status 'actions.runner.*'
readlink -f /home/devon/sparq-burnin-production/current
```

Both working directories should be `/home/devon/sparq-burnin-production/current`.
GitHub should show the runner as **Idle** before the first manual run. The
first deployment changes the current link; setup alone leaves it pointing at
the original checkout. Once this setup is active, use the workflow for releases
instead of rebuilding the original live checkout.

The installed deploy script is intentionally separate from release source.
When changing deployment behavior, review and reinstall the script on the host.
Adjust the service and `NODE_BIN_DIR` together when upgrading Node.
Once watchdog integration is installed, use releases v0.9.3 or later; older
watchdogs do not report the release identity required by deployment readiness.

References: [GitHub runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[runner networking](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
[manual workflow inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs).
