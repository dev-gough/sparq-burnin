#!/usr/bin/env bash
# One-time root setup. Does not restart or redeploy the running dashboard.
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo "Run with sudo on production" >&2; exit 1; }
APP_USER="${APP_USER:-devon}"
APP_DIR="${APP_DIR:-/home/devon/sparq-burnin}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/devon/sparq-burnin-production}"
UNIT="${UNIT:-burnin-dashboard.service}"
RUNNER_DIR="${RUNNER_DIR:-/home/devon/actions-runner}"
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$UNIT" =~ ^[a-zA-Z0-9_-]+\.service$ ]] || exit 1
[[ -d "$APP_DIR/.git" && -f "$APP_DIR/config.json" ]] || { echo "Production checkout missing" >&2; exit 1; }
install -d -m 700 -o "$APP_USER" -g "$(id -gn "$APP_USER")" "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases"
if [[ ! -e "$DEPLOY_ROOT/current" ]]; then
  runuser -u "$APP_USER" -- ln -s "$APP_DIR" "$DEPLOY_ROOT/current"
fi
[[ -L "$DEPLOY_ROOT/current" ]] || { echo "current must be a symlink" >&2; exit 1; }
install -d "/etc/systemd/system/$UNIT.d"
printf '[Service]\nWorkingDirectory=%s/current\n' "$DEPLOY_ROOT" > "/etc/systemd/system/$UNIT.d/production-deploy.conf"
sudoers="$(mktemp)"
trap 'rm -f "$sudoers"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl restart %s\n' "$APP_USER" "$UNIT" > "$sudoers"
visudo -cf "$sudoers"
install -m 440 "$sudoers" /etc/sudoers.d/burnin-production-deploy
systemctl daemon-reload
if [[ -f "$RUNNER_DIR/.runner" ]]; then
  cd "$RUNNER_DIR"
  if [[ ! -f .service ]]; then ./svc.sh install "$APP_USER"; fi
  ./svc.sh start
else
  echo "Runner not registered yet; register it, then rerun this script to install its service."
fi
echo "Production service prepared; dashboard has not been restarted."
