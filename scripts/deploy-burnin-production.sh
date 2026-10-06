#!/usr/bin/env bash
# Installed on production, invoked only by the manual GitHub workflow.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/home/devon/sparq-burnin}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/devon/sparq-burnin-production}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/devon/.nvm/versions/node/v24.11.1/bin}"
UNIT="${UNIT:-burnin-dashboard.service}"
SYSTEMCTL="${SYSTEMCTL:-/usr/bin/systemctl}"
REPO_URL="${REPO_URL:-https://github.com/dev-gough/sparq-burnin.git}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:9001/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"
SHA="${1:-}"
TAG="${2:-}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "expected a full checked commit SHA"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "expected an annotated vX.Y.Z tag"
export PATH="$NODE_BIN_DIR:$PATH"
for command in git node npm curl flock sudo; do
  command -v "$command" >/dev/null || die "missing command: $command"
done
[[ -d "$APP_DIR/.git" && -f "$APP_DIR/config.json" && -f "$APP_DIR/.env.local" ]] || die "production checkout/configuration missing"
[[ -L "$DEPLOY_ROOT/current" ]] || die "run setup-production-service.sh first"
[[ "$("$SYSTEMCTL" show "$UNIT" -p WorkingDirectory --value)" == "$DEPLOY_ROOT/current" ]] || die "service must use $DEPLOY_ROOT/current; run setup-production-service.sh"
sudo -n -l "$SYSTEMCTL" restart "$UNIT" >/dev/null || die "passwordless restart permission missing; run setup-production-service.sh"
mkdir -p "$DEPLOY_ROOT/releases"
exec 9>"$DEPLOY_ROOT/deploy.lock"
flock -n 9 || die "another production deployment is running"
previous="$(readlink -f "$DEPLOY_ROOT/current")"
previous_version="$(node -p "require(process.argv[1]).version" "$previous/package.json")"
switched=0

switch_to() {
  local target="$1"
  ln -s "$target" "$DEPLOY_ROOT/current.next.$$"
  mv -Tf "$DEPLOY_ROOT/current.next.$$" "$DEPLOY_ROOT/current"
}

health() {
  local version="$1" code
  for ((attempt=1; attempt<=HEALTH_RETRIES; attempt++)); do
    code="$(curl --silent --show-error --max-time 5 --config "$health_config" --output "$health_body" --write-out '%{http_code}' "$HEALTH_URL" || true)"
    if [[ "$code" == 200 ]] && node -e '
      const fs = require("fs");
      try {
        const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit(body.version === process.argv[2] && body.checks?.some(check => check.name === "database" && check.status === "ok") ? 0 : 1);
      } catch { process.exit(1); }
    ' "$health_body" "$version"; then return 0; fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  return 1
}

finish() {
  local status="$1"
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 && "$switched" -eq 1 ]]; then
    log "deployment failed; restoring $previous"
    if switch_to "$previous" && sudo -n "$SYSTEMCTL" restart "$UNIT" && health "$previous_version"; then
      log "previous release restored; database migrations remain applied"
    else
      printf 'ERROR: rollback needs attention; inspect %s\n' "$UNIT" >&2
    fi
  fi
  exit "$status"
}
trap 'finish $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "fetch and verify $TAG ($SHA) from GitHub"
git -C "$APP_DIR" fetch "$REPO_URL" "refs/heads/master:refs/remotes/production/master" "refs/tags/$TAG:refs/tags/$TAG"
[[ "$(git -C "$APP_DIR" cat-file -t "refs/tags/$TAG")" == tag ]] || die "tag is not annotated"
[[ "$(git -C "$APP_DIR" rev-parse "refs/tags/$TAG^{commit}")" == "$SHA" ]] || die "tag no longer points to checked commit"
git -C "$APP_DIR" merge-base --is-ancestor "$SHA" refs/remotes/production/master || die "release is not on master"

release="$(mktemp -d "$DEPLOY_ROOT/releases/$SHA.XXXXXX")"
git -C "$APP_DIR" archive "$SHA" | tar -x -C "$release"
[[ "v$(node -p "require(process.argv[1]).version" "$release/package.json")" == "$TAG" ]] || die "tag and package version differ"
# Keep configuration, ingest data, and logs on the server, shared with watchdog.
for name in config.json .env.local data log logs; do
  if [[ -e "$APP_DIR/$name" ]]; then ln -s "$APP_DIR/$name" "$release/$name"; fi
done
cd "$release"
log "install and build in $release (running app is untouched)"
npm ci
npm run build
printf '%s\n' "$SHA" > .production-commit

# Do not put the health token on a process command line or in CI output.
health_config="$release/.health-curl-config"
health_body="$release/.health-response.json"
node -e '
  const fs = require("fs");
  process.loadEnvFile(".env.local");
  const token = process.env.HEALTH_TOKEN?.trim();
  fs.writeFileSync(process.argv[1], token ? `header = ${JSON.stringify(`x-health-token: ${token}`)}\n` : "", { mode: 0o600 });
' "$health_config"

log "apply pending migrations before switching the app"
npm run migrate
log "activate release and restart $UNIT"
switch_to "$release"
switched=1
sudo -n "$SYSTEMCTL" restart "$UNIT"
health "${TAG#v}" || die "new release failed its version/database health check"
log "production healthy at $TAG ($SHA)"
