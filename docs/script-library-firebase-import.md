# Script library: Firebase → VPS Postgres

One-time cutover for `scriptLibrary` docs into `pg_documents` (collection_root `scriptLibrary`).

## Why ops/ for export

App `src/` + `scripts/` must not import `firebase` / `firebase-admin` (CI gate). The export CLI lives in `ops/` and may use a temporary `firebase-admin` install (`npm i firebase-admin --no-save`). Do **not** add it to `package.json`.

## 1. Export from old Firebase

```bash
# Smoke count
node ops/export-firestore-script-library.mjs --org=AYyMtDLz4FbLPiHnh5g2 --dry-run

# Write archives/firestore-scriptLibrary-<timestamp>/scriptLibrary.jsonl
node ops/export-firestore-script-library.mjs --org=AYyMtDLz4FbLPiHnh5g2
```

Requires `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` in `.env.local`.

## 2. Import into target Postgres

Point `DATABASE_URL` (and RLS bypass via app role / migrate URL as usual) at the **target** DB (local Docker or VPS).

```bash
# Dry-run
npx tsx scripts/import-script-library-archive.ts \
  --file=archives/firestore-scriptLibrary-…/scriptLibrary.jsonl \
  --org=AYyMtDLz4FbLPiHnh5g2 \
  --dry-run

# Apply
npx tsx scripts/import-script-library-archive.ts \
  --file=archives/firestore-scriptLibrary-…/scriptLibrary.jsonl \
  --org=AYyMtDLz4FbLPiHnh5g2
```

Idempotent upserts by path `scriptLibrary/{id}`.

### VPS (production) — fastest path (SQL)

Export also writes `import-vps.sql` next to the JSONL. Copy and apply without waiting for a new image:

```bash
# From laptop
scp archives/firestore-scriptLibrary-stellix/import-vps.sql deploy@VPS_HOST:/tmp/

# On VPS
cd /opt/nova-crm
docker compose -f docker-compose.prod.yml -f docker-compose.prod.images.yml \
  exec -T postgres psql -U nova -d nova_crm -v ON_ERROR_STOP=1 < /tmp/import-vps.sql
```

### VPS — TS importer (after this branch is on the VPS checkout)

```bash
scp -r archives/firestore-scriptLibrary-stellix deploy@VPS_HOST:/opt/nova-crm/archives/
# On VPS, with DATABASE_URL from .env.production:
npx tsx scripts/import-script-library-archive.ts \
  --file=archives/firestore-scriptLibrary-stellix/scriptLibrary.jsonl \
  --org=AYyMtDLz4FbLPiHnh5g2
```

## 3. Verify

- UI: `/scripts` for workspace **Stellix Soft LLC live** should list scripts.
- SQL: `SELECT count(*) FROM pg_documents WHERE collection_root = 'scriptLibrary' AND organization_id = 'AYyMtDLz4FbLPiHnh5g2';`

Admins/owners see all org scripts; non-admins only see rows where `ownerUid` matches their Clerk uid. Remap owners later if needed.
