#!/usr/bin/env bash
# Deploy burnin-dashboard on the lab host and restart its systemd unit.
# Modeled on sparq-toolbox scripts/deploy-sparq-toolbox.sh.
#
# Install on labserver (once):
#   install -m 755 scripts/deploy-burnin-dashboard.sh /home/server/bin/deploy-burnin-dashboard.sh
#
# Sudoers (exact argv match):
#   server ALL=(root) NOPASSWD: /usr/bin/systemctl restart burnin-dashboard
#   server ALL=(root) NOPASSWD: /usr/bin/systemctl is-active burnin-dashboard
#   server ALL=(root) NOPASSWD: /usr/bin/systemctl status burnin-dashboard
#
# Safe for Gitea Actions host runner (label: labserver). git reset --hard does
# not touch ignored files, so config.json, .env.local, data/, and logs/ are
# preserved across deploys.
#
# Ordering note: `npm run migrate` runs BEFORE the restart on purpose — the
# HTTPS ingest auth fails closed without migration 014 (IngestNonces), so the
# new code must never serve station traffic against an unmigrated DB. A failed
# migration aborts the deploy and the old build keeps running.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/server/burnin-dashboard}"
UNIT="${UNIT:-burnin-dashboard}"
BRANCH="${BRANCH:-master}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/server/.nvm/versions/node/v22.14.0/bin}"
SYSTEMCTL="${SYSTEMCTL:-/usr/bin/systemctl}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:9001/api/health}"
# Optional: matches the app's HEALTH_TOKEN env (x-health-token header).
HEALTH_TOKEN="${HEALTH_TOKEN:-}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Passwordless sudo with pinned absolute path (matches sudoers drop-in).
sc() {
  if ! sudo -n "$SYSTEMCTL" "$@"; then
    die "passwordless systemctl failed: sudo -n ${SYSTEMCTL} $*
Check /etc/sudoers.d/ for user '$(id -un)' and path ${SYSTEMCTL}.
Example:
  $(id -un) ALL=(root) NOPASSWD: ${SYSTEMCTL} restart ${UNIT}
  $(id -un) ALL=(root) NOPASSWD: ${SYSTEMCTL} is-active ${UNIT}
  $(id -un) ALL=(root) NOPASSWD: ${SYSTEMCTL} status ${UNIT}"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

require_cmd git
require_cmd curl
require_cmd sudo
[[ -x "$SYSTEMCTL" ]] || die "systemctl not found at $SYSTEMCTL"
[[ -d "$APP_DIR/.git" ]] || die "not a git checkout: $APP_DIR"
[[ -x "$NODE_BIN_DIR/node" ]] || die "node not found at $NODE_BIN_DIR/node"
[[ -x "$NODE_BIN_DIR/npm" ]] || die "npm not found at $NODE_BIN_DIR/npm"

export PATH="$NODE_BIN_DIR:$PATH"
log "node $(node -v) / npm $(npm -v)"
log "deploying $APP_DIR (branch=$BRANCH) → unit $UNIT"

cd "$APP_DIR"

[[ -f config.json ]] || die "config.json missing in $APP_DIR — the app and \
migrations read the DB and ingest/auth settings from it (see config.template.json)"

if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null || true)" ]]; then
  log "warning: tracked files differ from HEAD before reset:"
  git status --short --untracked-files=no || true
fi

log "fetch + reset to origin/${BRANCH}"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

log "HEAD $(git rev-parse --short HEAD) — $(git log -1 --pretty=format:'%s')"

log "install dependencies"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "build"
npm run build

# migrate-db.ts keeps its own exactly-once ledger (migrations table) and every
# migration is internally idempotent — no baseline step required.
log "apply pending database migrations"
npm run migrate

log "restart ${UNIT}"
sc restart "$UNIT"

log "wait for unit active"
for i in $(seq 1 20); do
  state="$(sudo -n "$SYSTEMCTL" is-active "$UNIT" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    log "unit is active"
    break
  fi
  if [[ "$i" -eq 20 ]]; then
    sudo -n "$SYSTEMCTL" status "$UNIT" || true
    die "unit ${UNIT} did not become active (last state: ${state:-unknown})"
  fi
  sleep 1
done

log "health check ${HEALTH_URL}"
# The app 401s /api/health when its HEALTH_TOKEN env is set. If the caller
# didn't provide the token, pull it from the checkout's .env.local (the same
# file the unit's next-server reads it from).
if [[ -z "$HEALTH_TOKEN" && -f "$APP_DIR/.env.local" ]]; then
  HEALTH_TOKEN="$(grep -E '^HEALTH_TOKEN=' "$APP_DIR/.env.local" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"
fi
curl_args=(-sS -o /dev/null -w '%{http_code}' --max-time 5)
if [[ -n "$HEALTH_TOKEN" ]]; then
  curl_args+=(-H "x-health-token: ${HEALTH_TOKEN}")
fi
ok=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  code="$(curl "${curl_args[@]}" "$HEALTH_URL" || true)"
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    log "health OK (HTTP ${code}) after ${i} attempt(s)"
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP_SEC"
done
[[ "$ok" -eq 1 ]] || die "health check failed for ${HEALTH_URL}"

log "deploy complete: $(git rev-parse --short HEAD)"
