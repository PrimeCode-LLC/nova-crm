#!/usr/bin/env bash
# Post-deploy smoke checks — web health, worker health, safe cron dispatch only.
# Never dispatch imap-sync or scheduled-email here (those can trigger real email/IMAP work).
#
# Containers report "Started" before Next.js/worker bind their ports. Caddy then
# returns 502 until the upstream is ready — so every check here retries with a
# deadline instead of failing on the first attempt.
set -euo pipefail

SAFE_CRON_SMOKE_JOB="dashboard-summary"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-https://nova.stellixsoft.com/api/health}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-180}"
SMOKE_POLL_SECONDS="${SMOKE_POLL_SECONDS:-5}"

COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"

cd "${COMPOSE_DIR}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml --env-file "${ENV_FILE}")

wait_until() {
  local label="$1"
  local deadline=$(( $(date +%s) + SMOKE_TIMEOUT_SECONDS ))
  shift
  echo "=== Smoke: ${label} (timeout ${SMOKE_TIMEOUT_SECONDS}s) ==="
  while :; do
    if "$@"; then
      echo "  ok"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "  timed out waiting for: ${label}" >&2
      return 1
    fi
    sleep "${SMOKE_POLL_SECONDS}"
  done
}

container_healthy() {
  local svc="$1"
  local cid
  cid="$("${COMPOSE[@]}" ps -q "${svc}" 2>/dev/null || true)"
  if [[ -z "${cid}" ]]; then
    return 1
  fi
  local state health
  state="$(docker inspect --format '{{.State.Status}}' "${cid}")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${cid}")"
  [[ "${state}" == "running" && "${health}" == "healthy" ]]
}

public_web_healthy() {
  local body
  body="$(curl -fsS --max-time 15 "${WEB_HEALTH_URL}" 2>/dev/null)" || return 1
  [[ "${body}" == *'"ok":true'* ]]
}

worker_healthy() {
  local body
  body="$("${COMPOSE[@]}" exec -T worker wget -qO- http://127.0.0.1:8081/healthz 2>/dev/null)" || return 1
  [[ "${body}" == *'"ok":true'* ]]
}

cron_dispatch_ok() {
  local body
  body="$("${COMPOSE[@]}" exec -T cron /usr/local/bin/cron-dispatch.sh "${SAFE_CRON_SMOKE_JOB}" 2>/dev/null)" || return 1
  [[ "${body}" == *'"ok":true'* ]]
}

# Prefer Docker HEALTHCHECK first — it hits the app inside the container and
# avoids flaky 502s from Caddy while Next.js is still booting.
wait_until "web container healthy" container_healthy web
wait_until "worker container healthy" container_healthy worker
wait_until "web GET ${WEB_HEALTH_URL}" public_web_healthy
wait_until "worker GET /healthz" worker_healthy
wait_until "cron dispatch enqueue (${SAFE_CRON_SMOKE_JOB})" cron_dispatch_ok

echo "=== Smoke tests passed ==="
