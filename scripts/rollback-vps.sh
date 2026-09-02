#!/usr/bin/env bash
# Roll back application images to a previously deployed immutable SHA.
# Does NOT reverse database migrations automatically.
set -euo pipefail

PRODUCTION_BRANCH="feature/remove-firebase"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"

DEPLOY_REF="${DEPLOY_REF:?set DEPLOY_REF}"
ROLLBACK_SHA="${ROLLBACK_SHA:?set ROLLBACK_SHA to a previously known-good commit SHA}"
GHCR_OWNER="${GHCR_OWNER:?set GHCR_OWNER}"

if [[ "${DEPLOY_REF}" != "${PRODUCTION_BRANCH}" ]]; then
  echo "REFUSING: DEPLOY_REF must be ${PRODUCTION_BRANCH} (got ${DEPLOY_REF})" >&2
  exit 1
fi

if [[ ! "${ROLLBACK_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "REFUSING: ROLLBACK_SHA must be a 40-char git commit SHA" >&2
  exit 1
fi

cat <<'LIMITATIONS'
=== Rollback limitations ===
- This script rolls back APPLICATION IMAGES only (web/worker/cron).
- It does NOT run prisma migrate rollback or reverse DDL.
- If the failed deploy applied a forward-only migration, rolling back images
  may be incompatible until you restore Postgres from backup or run a
  corrective forward migration on feature/remove-firebase.
- Do NOT checkout or deploy main on the VPS.
LIMITATIONS

GHCR_OWNER="$(printf '%s' "${GHCR_OWNER}" | tr '[:upper:]' '[:lower:]')"
export NOVA_IMAGE_TAG="${ROLLBACK_SHA}"
export GHCR_OWNER

cd "${COMPOSE_DIR}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml --env-file "${ENV_FILE}")

echo "=== Pull rollback images ==="
"${COMPOSE[@]}" pull web worker cron

echo "=== Recreate application services at ${ROLLBACK_SHA} (no migrate, no build) ==="
"${COMPOSE[@]}" up -d --no-build --remove-orphans web worker cron caddy

echo "=== Post-rollback smoke tests ==="
DEPLOY_SHA="${ROLLBACK_SHA}" COMPOSE_DIR="${COMPOSE_DIR}" ENV_FILE="${ENV_FILE}" \
  "${COMPOSE_DIR}/scripts/smoke-post-deploy.sh"

echo "=== Rollback succeeded ==="
echo "  active_sha=${ROLLBACK_SHA}"
