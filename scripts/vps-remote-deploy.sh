#!/usr/bin/env bash
# Remote half of the automated production deploy.
#
# The workflow pipes this file into `bash -s` over SSH, prefixed with `export`
# lines for DEPLOY_*/GHCR_*/WEB_HEALTH_URL. Passing them on stdin instead of the
# ssh command line keeps the GHCR token out of the VPS process list.
#
# Responsibilities: pin the checkout to an immutable SHA, authenticate to GHCR,
# then hand off to scripts/deploy-vps.sh (the source of truth for the actual
# deploy) and scripts/verify-deployed-sha.sh.
set -euo pipefail

PRODUCTION_BRANCH="feature/remove-firebase"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"

DEPLOY_REF="${DEPLOY_REF:?set DEPLOY_REF}"
DEPLOY_SHA="${DEPLOY_SHA:?set DEPLOY_SHA}"
GHCR_OWNER="${GHCR_OWNER:?set GHCR_OWNER}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:?set WEB_HEALTH_URL}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [[ "${DEPLOY_REF}" != "${PRODUCTION_BRANCH}" ]]; then
  echo "REFUSING: DEPLOY_REF must be ${PRODUCTION_BRANCH} (got ${DEPLOY_REF})" >&2
  exit 1
fi

if [[ ! "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "REFUSING: DEPLOY_SHA must be a 40-char git commit SHA" >&2
  exit 1
fi

GHCR_OWNER="$(printf '%s' "${GHCR_OWNER}" | tr '[:upper:]' '[:lower:]')"
export GHCR_OWNER

cd "${COMPOSE_DIR}"

echo "=== Preflight ==="
echo "  compose dir: ${COMPOSE_DIR}"
echo "  branch:      ${DEPLOY_REF}"
echo "  deploy sha:  ${DEPLOY_SHA}"
echo "  registry:    ghcr.io/${GHCR_OWNER}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "REFUSING: missing ${ENV_FILE}. CI never creates or overwrites it." >&2
  exit 1
fi
# Fingerprint by inode/mtime/size — never by content, so nothing secret is derived.
ENV_FINGERPRINT_BEFORE="$(stat -c '%i:%Y:%s' "${ENV_FILE}")"
echo "  env file:    present (contents never read or printed)"

echo "=== Sync checkout to ${DEPLOY_SHA} ==="
git fetch --prune origin "${PRODUCTION_BRANCH}"

if ! git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null; then
  echo "REFUSING: ${DEPLOY_SHA} not found after fetching origin/${PRODUCTION_BRANCH}" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "${DEPLOY_SHA}" "origin/${PRODUCTION_BRANCH}"; then
  echo "REFUSING: ${DEPLOY_SHA} is not an ancestor of origin/${PRODUCTION_BRANCH}" >&2
  echo "          (guards against deploying main or any non-production commit)" >&2
  exit 1
fi

# reset --hard only touches tracked files; .env.production is gitignored and
# there is intentionally no `git clean` here.
git checkout -f -B "${PRODUCTION_BRANCH}" "${DEPLOY_SHA}"
git reset --hard "${DEPLOY_SHA}"

HEAD_SHA="$(git rev-parse HEAD)"
if [[ "${HEAD_SHA}" != "${DEPLOY_SHA}" ]]; then
  echo "REFUSING: HEAD is ${HEAD_SHA}, expected ${DEPLOY_SHA}" >&2
  exit 1
fi
echo "  HEAD=${HEAD_SHA}"

echo "=== GHCR authentication ==="
if [[ -n "${GHCR_TOKEN}" ]]; then
  printf '%s' "${GHCR_TOKEN}" \
    | docker login ghcr.io -u "${GHCR_USERNAME:-x-access-token}" --password-stdin >/dev/null
  echo "  logged in to ghcr.io"
else
  echo "  no token supplied — using the VPS's existing docker login"
fi
unset GHCR_TOKEN

chmod +x \
  scripts/deploy-vps.sh \
  scripts/smoke-post-deploy.sh \
  scripts/rollback-vps.sh \
  scripts/verify-deployed-sha.sh

echo "=== Running production deploy script ==="
DEPLOY_REF="${DEPLOY_REF}" \
DEPLOY_SHA="${DEPLOY_SHA}" \
GHCR_OWNER="${GHCR_OWNER}" \
WEB_HEALTH_URL="${WEB_HEALTH_URL}" \
COMPOSE_DIR="${COMPOSE_DIR}" \
ENV_FILE="${ENV_FILE}" \
  ./scripts/deploy-vps.sh

echo "=== Verifying deployed SHA is live ==="
DEPLOY_SHA="${DEPLOY_SHA}" \
GHCR_OWNER="${GHCR_OWNER}" \
WEB_HEALTH_URL="${WEB_HEALTH_URL}" \
COMPOSE_DIR="${COMPOSE_DIR}" \
ENV_FILE="${ENV_FILE}" \
  ./scripts/verify-deployed-sha.sh

echo "=== Verifying .env.production was untouched ==="
ENV_FINGERPRINT_AFTER="$(stat -c '%i:%Y:%s' "${ENV_FILE}")"
if [[ "${ENV_FINGERPRINT_BEFORE}" != "${ENV_FINGERPRINT_AFTER}" ]]; then
  echo "REFUSING to report success: ${ENV_FILE} changed during deploy" >&2
  exit 1
fi
echo "  unchanged"

echo "=== Deployment completed successfully ==="
echo "  deployed_sha=${DEPLOY_SHA}"
