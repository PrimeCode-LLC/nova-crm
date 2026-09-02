#!/usr/bin/env bash
# Post-deploy smoke checks — web health, worker health, safe cron dispatch only.
# Never dispatch imap-sync or scheduled-email here (those can trigger real email/IMAP work).
set -euo pipefail

SAFE_CRON_SMOKE_JOB="dashboard-summary"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-https://nova.stellixsoft.com/api/health}"

COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"

cd "${COMPOSE_DIR}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml --env-file "${ENV_FILE}")

echo "=== Smoke: web GET ${WEB_HEALTH_URL} ==="
curl -sfS "${WEB_HEALTH_URL}" | grep -q '"ok":true'

echo "=== Smoke: worker GET /healthz ==="
"${COMPOSE[@]}" exec -T worker wget -qO- http://127.0.0.1:8081/healthz | grep -q '"ok":true'

echo "=== Smoke: cron dispatch enqueue (${SAFE_CRON_SMOKE_JOB} — queue only, no email/IMAP) ==="
"${COMPOSE[@]}" exec -T cron /usr/local/bin/cron-dispatch.sh "${SAFE_CRON_SMOKE_JOB}" | grep -q '"ok":true'

echo "=== Smoke tests passed ==="
