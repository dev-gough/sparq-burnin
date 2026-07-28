#!/usr/bin/env bash
# lab-ack-window.sh — hold the HTTPS ingest "ack window" open for lab tests
# LT-04 (power cut), LT-06 (backlog drain), LT-09 (deploy mid-upload).
#
# Runs ON the labserver (install: /home/server/bin/lab-ack-window.sh).
#
#   open    stop the dashboard so completed tests pile up in the station
#           outbox as `pending` (interactive sudo — sudoers has no stop rule)
#   close   restore via the passwordless restart rule; wait active + health 200
#   status  unit state + health probe
#   verify  DB exactly-once check: recent HTTPS rows, receipts, duplicates
#
# The point: with the dashboard down BEFORE a test ends there is no sub-second
# timing to hit — the ack window stays open until you `close` it.
set -euo pipefail

UNIT="${UNIT:-burnin-dashboard}"
APP_DIR="${APP_DIR:-/home/server/burnin-dashboard}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:9001/api/health}"
NODE_BIN_DIR="${NODE_BIN_DIR:-}"

log() { printf '[lab-ack-window] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

health_token() {
  [[ -f "$APP_DIR/.env.local" ]] || return 0
  grep -E '^HEALTH_TOKEN=' "$APP_DIR/.env.local" | tail -1 | cut -d= -f2- \
    | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true
}

health_code() {
  local token curl_args=(-s -o /dev/null -w '%{http_code}' --max-time 5)
  token="$(health_token)"
  [[ -n "$token" ]] && curl_args+=(-H "x-health-token: ${token}")
  curl "${curl_args[@]}" "$HEALTH_URL" || echo "000"
}

unit_active() { sudo -n systemctl is-active "$UNIT" 2>/dev/null || true; }

cmd_open() {
  log "stopping ${UNIT} — the ack window is OPEN until 'close'"
  log "(sudoers has no stop rule; expect a password prompt)"
  sudo systemctl stop "$UNIT"
  [[ "$(unit_active)" == "inactive" ]] || die "unit did not stop"
  log "dashboard DOWN at $(date -Is). Completed tests will sit in the"
  log "station outbox as pending. Cut power / run the fault whenever ready."
}

cmd_close() {
  log "restarting ${UNIT} (passwordless restart rule)"
  sudo -n systemctl restart "$UNIT"
  for i in $(seq 1 30); do
    [[ "$(unit_active)" == "active" ]] && break
    sleep 1
  done
  [[ "$(unit_active)" == "active" ]] || die "unit did not become active"
  for i in $(seq 1 30); do
    code="$(health_code)"
    if [[ "$code" == "200" ]]; then
      log "health OK (HTTP 200) after ${i} attempt(s) — window CLOSED at $(date -Is)"
      log "station outbox should drain within one retry interval; run 'verify' after."
      return 0
    fi
    sleep 2
  done
  die "health check never returned 200 (last: ${code})"
}

cmd_status() {
  log "unit: $(unit_active)  health: HTTP $(health_code)"
}

cmd_verify() {
  [[ -f "$APP_DIR/config.json" ]] || die "no config.json in $APP_DIR"
  [[ -n "$NODE_BIN_DIR" ]] && export PATH="$NODE_BIN_DIR:$PATH"
  cd "$APP_DIR"
  node - <<'EOF'
const cfg = require('./config.json').database
const { Client } = require('pg')
;(async () => {
  const c = new Client({ host: cfg.host, port: cfg.port, database: cfg.name, user: cfg.user, password: cfg.password })
  await c.connect()
  const recent = await c.query(`
    SELECT t.test_id, i.serial_number, t.start_time_utc, t.overall_status, t.created_at
    FROM tests t JOIN inverters i ON i.inv_id = t.inv_id
    WHERE t.source_file LIKE 'https:%' AND t.created_at > now() - interval '2 hours'
    ORDER BY t.test_id DESC`)
  console.log(`HTTPS rows in the last 2h: ${recent.rows.length}`)
  for (const r of recent.rows.slice(0, 15)) {
    console.log(`  #${r.test_id} SN ${r.serial_number} start=${r.start_time_utc.toISOString()} ${r.overall_status} (ingested ${r.created_at.toISOString()})`)
  }
  const dupes = await c.query(`
    SELECT inv_id, start_time_utc, count(*) AS n, array_agg(test_id) AS ids
    FROM tests WHERE created_at > now() - interval '24 hours'
    GROUP BY inv_id, start_time_utc HAVING count(*) > 1`)
  if (dupes.rows.length) {
    console.log('DUPLICATE (inv_id, start_time_utc) GROUPS — exactly-once VIOLATED:')
    for (const d of dupes.rows) console.log(`  inv ${d.inv_id} @ ${d.start_time_utc.toISOString()}: tests ${d.ids.join(', ')}`)
    process.exitCode = 2
  } else {
    console.log('No duplicate (inv_id, start_time_utc) groups in 24h — exactly-once holds.')
  }
  const receipts = await c.query(`
    SELECT count(*) AS n FROM ingestreceipts WHERE created_at > now() - interval '2 hours'`)
  console.log(`Receipts in the last 2h: ${receipts.rows[0].n}`)
  await c.end()
})().catch((e) => { console.error(e.message); process.exit(1) })
EOF
}

case "${1:-status}" in
  open)   cmd_open ;;
  close)  cmd_close ;;
  status) cmd_status ;;
  verify) cmd_verify ;;
  *) die "usage: $0 open|close|status|verify" ;;
esac
