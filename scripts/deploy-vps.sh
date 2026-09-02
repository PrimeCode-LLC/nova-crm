#!/usr/bin/env bash
# Production VPS deploy — immutable GHCR images only (no local build, no main).
set -euo pipefail

PRODUCTION_BRANCH="feature/remove-firebase"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"

DEPLOY_REF="${DEPLOY_REF:?set DEPLOY_REF}"
DEPLOY_SHA="${DEPLOY_SHA:?set DEPLOY_SHA}"
GHCR_OWNER="${GHCR_OWNER:?set GHCR_OWNER (lowercase GitHub org/user)}"

if [[ "${DEPLOY_REF}" != "${PRODUCTION_BRANCH}" ]]; then
  echo "REFUSING: DEPLOY_REF must be ${PRODUCTION_BRANCH} (got ${DEPLOY_REF})" >&2
  exit 1
fi

if [[ ! "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "REFUSING: DEPLOY_SHA must be a 40-char git commit SHA" >&2
  exit 1
fi

GHCR_OWNER="$(printf '%s' "${GHCR_OWNER}" | tr '[:upper:]' '[:lower:]')"
export NOVA_IMAGE_TAG="${DEPLOY_SHA}"
export GHCR_OWNER

cd "${COMPOSE_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml --env-file "${ENV_FILE}")

echo "=== Nova CRM production deploy ==="
echo "  branch policy: ${PRODUCTION_BRANCH}"
echo "  image tag:     ${NOVA_IMAGE_TAG}"
echo "  registry:      ghcr.io/${GHCR_OWNER}"

echo "=== Pull immutable images ==="
"${COMPOSE[@]}" pull web worker migrate cron

echo "=== Run database migrations ==="
"${COMPOSE[@]}" run --rm migrate

echo "=== Start / recreate application services (no build) ==="
"${COMPOSE[@]}" up -d --no-build --remove-orphans web worker cron caddy

echo "=== Post-deploy smoke tests ==="
DEPLOY_SHA="${DEPLOY_SHA}" COMPOSE_DIR="${COMPOSE_DIR}" ENV_FILE="${ENV_FILE}" \
  "${COMPOSE_DIR}/scripts/smoke-post-deploy.sh"

echo "=== Deploy succeeded ==="
echo "  deployed_sha=${DEPLOY_SHA}"
