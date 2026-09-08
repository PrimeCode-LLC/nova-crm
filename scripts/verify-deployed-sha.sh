#!/usr/bin/env bash
# Prove the SHA we intended to deploy is the SHA actually serving production.
# Read-only: inspects containers and hits the public health endpoint, never mutates state.
# Container logs are deliberately not printed — they can echo connection strings.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/nova-crm}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env.production}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-https://nova.stellixsoft.com/api/health}"
CONTAINER_HEALTH_TIMEOUT="${CONTAINER_HEALTH_TIMEOUT:-180}"
PUBLIC_HEALTH_TIMEOUT="${PUBLIC_HEALTH_TIMEOUT:-90}"

DEPLOY_SHA="${DEPLOY_SHA:?set DEPLOY_SHA}"
GHCR_OWNER="${GHCR_OWNER:?set GHCR_OWNER}"

if [[ ! "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "REFUSING: DEPLOY_SHA must be a 40-char git commit SHA" >&2
  exit 1
fi

GHCR_OWNER="$(printf '%s' "${GHCR_OWNER}" | tr '[:upper:]' '[:lower:]')"
export GHCR_OWNER
export NOVA_IMAGE_TAG="${DEPLOY_SHA}"

cd "${COMPOSE_DIR}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml --env-file "${ENV_FILE}")

echo "=== Verify: repository HEAD ==="
if git rev-parse --git-dir >/dev/null 2>&1; then
  HEAD_SHA="$(git rev-parse HEAD)"
  echo "  HEAD=${HEAD_SHA}"
  if [[ "${HEAD_SHA}" != "${DEPLOY_SHA}" ]]; then
    echo "  HEAD does not match DEPLOY_SHA=${DEPLOY_SHA}" >&2
    exit 1
  fi
else
  echo "  ${COMPOSE_DIR} is not a git checkout — skipping HEAD assertion"
fi

echo "=== Verify: running container image tags ==="
tag_mismatch=0
for svc in web worker cron; do
  cid="$("${COMPOSE[@]}" ps -q "${svc}" 2>/dev/null || true)"
  if [[ -z "${cid}" ]]; then
    echo "  ${svc}: NO RUNNING CONTAINER" >&2
    tag_mismatch=1
    continue
  fi
  image="$(docker inspect --format '{{.Config.Image}}' "${cid}")"
  echo "  ${svc}: ${image}"
  if [[ "${image}" != *":${DEPLOY_SHA}" ]]; then
    echo "  ${svc}: image is not tagged ${DEPLOY_SHA}" >&2
    tag_mismatch=1
  fi
done
if [[ "${tag_mismatch}" -ne 0 ]]; then
  echo "Running images do not correspond to DEPLOY_SHA=${DEPLOY_SHA}" >&2
  exit 1
fi

echo "=== Verify: container health (web, worker) ==="
health_deadline=$(( $(date +%s) + CONTAINER_HEALTH_TIMEOUT ))
for svc in web worker; do
  label="$(printf '%s' "${svc}" | tr '[:lower:]' '[:upper:]')"
  cid="$("${COMPOSE[@]}" ps -q "${svc}")"
  while :; do
    state="$(docker inspect --format '{{.State.Status}}' "${cid}")"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${cid}")"
    if [[ "${health}" == "healthy" ]]; then
      echo "  ${label}=${health}"
      break
    fi
    if [[ "${state}" != "running" || "${health}" == "unhealthy" || "${health}" == "none" ]]; then
      echo "  ${label} state=${state} health=${health} — inspect on the VPS with:" >&2
      echo "    docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml logs --tail 100 ${svc}" >&2
      exit 1
    fi
    if (( $(date +%s) >= health_deadline )); then
      echo "  ${label} still '${health}' after ${CONTAINER_HEALTH_TIMEOUT}s" >&2
      exit 1
    fi
    sleep 5
  done
done

echo "=== Verify: public health ${WEB_HEALTH_URL} ==="
public_deadline=$(( $(date +%s) + PUBLIC_HEALTH_TIMEOUT ))
while :; do
  if body="$(curl -fsS --max-time 15 "${WEB_HEALTH_URL}" 2>/dev/null)" && [[ "${body}" == *'"ok":true'* ]]; then
    echo "  ${body}"
    break
  fi
  if (( $(date +%s) >= public_deadline )); then
    echo "  no healthy response within ${PUBLIC_HEALTH_TIMEOUT}s" >&2
    exit 1
  fi
  sleep 5
done

echo "=== Deployed containers ==="
docker ps -a --filter name=nova-crm --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

echo "=== Verification passed for ${DEPLOY_SHA} ==="
