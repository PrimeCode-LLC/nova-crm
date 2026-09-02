#!/bin/sh
# Enqueue one BullMQ heavy job via web internal dispatch route.
# Requires CRON_SECRET and WEB_INTERNAL_URL (set by compose).
set -eu

JOB="${1:?job name required}"

curl -sfS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET:?CRON_SECRET is required}" \
  -H "Content-Type: application/json" \
  -d "{\"job\":\"${JOB}\"}" \
  "${WEB_INTERNAL_URL:?WEB_INTERNAL_URL is required}/api/cron/queue/dispatch"
