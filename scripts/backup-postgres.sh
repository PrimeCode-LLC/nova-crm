#!/usr/bin/env bash
# Daily Postgres backup (P7.10). Copy output off-VPS — do not keep only on same host.
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${BACKUP_DIR:-./backups}/nova_crm_${TS}.sql.gz"
mkdir -p "$(dirname "$OUT")"
pg_dump "${MIGRATE_DATABASE_URL:?set MIGRATE_DATABASE_URL}" | gzip > "$OUT"
echo "Wrote $OUT"
