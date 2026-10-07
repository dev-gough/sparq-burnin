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
Turbopack from tracing log links outside the release directory. It then runs
`npm run migrate`, atomically switches `current`, restarts the dashboard, and
checks the health response's release version and database status. Build and
migration failures leave the running application in place. Failed startup or
health checks switch back to the previous release and restart it.

This workflow deploys the dashboard service only. The watchdog still runs from
the original checkout, and its configured `dashboard_dir` determines where it
runs CSV ingestion. Changes to watchdog or ingestion scripts in a release do
not become active through this workflow; those require a separate update of
the pipeline checkout and a watchdog restart.

Database migrations remain applied after application rollback. New migrations
must be compatible with the previous application version. Release directories
are retained for inspection and rollback; remove obsolete releases manually
after confirming they are not `current` or your intended rollback target.

## One-time setup

The production service currently runs as `devon`, from `/home/devon/sparq-burnin`,
using `/home/devon/.nvm/versions/node/v24.11.1/bin/npm`. The setup below preserves
that checkout for the watchdog and shared configuration.

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

This creates the release directories and a `current` link to the existing
checkout, adds a systemd override for that link, grants `devon` passwordless
permission for **only** `systemctl restart burnin-dashboard.service`, and installs
and starts the registered runner as a service. It reloads systemd but does not
restart the dashboard or deploy a release. Rerunning it is supported.

On GitHub, create a **production** environment and restrict deployment branches
to **master**. Use required reviewers if a second approval is wanted. Keep the
self-hosted job limited to this manual workflow; PR checks run on GitHub-hosted
machines, not the production server.

## Verification and maintenance

```bash
systemctl show burnin-dashboard.service -p WorkingDirectory
sudo systemctl status 'actions.runner.*'
readlink -f /home/devon/sparq-burnin-production/current
```

The working directory should be `/home/devon/sparq-burnin-production/current`.
GitHub should show the runner as **Idle** before the first manual run. The
first deployment changes the current link; setup alone leaves it pointing at
the original checkout. Once this setup is active, use the workflow for releases
instead of rebuilding the original live checkout.

The installed deploy script is intentionally separate from release source.
When changing deployment behavior, review and reinstall the script on the host.
Adjust the service and `NODE_BIN_DIR` together when upgrading Node.

References: [GitHub runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[runner networking](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
[manual workflow inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs).
