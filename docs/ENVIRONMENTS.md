# Environments — separation rules

Expands
[`Architecture fixes plan/nova-crm-implementation-guide.md`](../Architecture%20fixes%20plan/nova-crm-implementation-guide.md) §5
and [`NOVA-CRM-ENGINEERING-RULES.md`](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) §3
(“Staging never touches production data”).

**Signed off:** 2026-08-19 — local / staging / production must never share a database or production secrets. PostgreSQL is the only database of record (Firebase cutover flags are gone).

## The three environments

| Environment | Purpose | Data | Deploys |
|-------------|---------|------|---------|
| **Local / dev** | Individual development | Compose Postgres + Redis (`docker compose up -d postgres redis`); seed/fake data only | Manual (`npm run dev`) |
| **Staging** | Pre-production validation, QA, demos | Realistic but **not** real customer data | Separate VPS/DB; deploy from `feature/remove-firebase` CI images (optional) |
| **Production** | Real customers on VPS | Real | **`feature/remove-firebase` only** — GHCR immutable SHA → manual GitHub Environment approval → `scripts/deploy-vps.sh` |

## Hard rules (non-negotiable)

1. **Separate accounts per environment** — Clerk apps, Postgres, Redis, and third-party keys are not shared across envs.
2. **Separate databases entirely** — different Postgres instances, credentials, and network access. Never point staging (or local) at prod “just to test.”
3. **Separate Redis / cache** — local Compose Redis is for local only; staging and prod use their own Redis.
4. **Separate secrets** — production secrets must not be readable from staging or laptop `.env` files committed to git. Use each environment’s secrets manager / GitHub Environments.
5. **Separate third-party sandboxes where it matters** — email senders, AI providers, verification APIs: staging keys must not burn production quotas or touch real customer inboxes.

## Local defaults (Compose)

| Service | URL / connection |
|---------|------------------|
| Postgres 16 + pgvector | Superuser (migrate): `postgres://nova:nova_dev_password@localhost:5432/nova_crm` · App (RLS): `postgres://nova_app:nova_dev_password@localhost:5432/nova_crm` |
| Redis 7 | `redis://localhost:6379` |

Set in local `.env.local` (see `.env.example`):

- `DATABASE_URL` — app role `nova_app` (Prisma Client / RLS enforced)
- `MIGRATE_DATABASE_URL` — Compose superuser `nova` (Prisma Migrate DDL)
- `REDIS_URL` — dashboard cache (`src/lib/cache/redis.ts`) and BullMQ (`src/lib/queue/*`)

These credentials are **dev-only**. Do not reuse them in staging or production.

Local migrate: `docker compose up -d postgres redis` then `npm run db:migrate:deploy` (or `npm run db:migrate` when adding models).

Tenant queries: use `withOrganizationScope(orgId, …)` from `src/lib/db/tenant-scope.ts` so Postgres RLS (`app.organization_id`) applies. Use `withRlsBypass` only for platform/ETL paths.

Optional pool tuning: `PG_POOL_MAX` (default 10) for the Prisma `pg` pool.

### One-time ETL (legacy soak)

`npm run db:backfill:*` and `npm run db:reconcile:*` exist for historical Firestore → Postgres soaks. They are **not** daily ops. If you still need them, run against **staging** first — never production from a laptop.

## BullMQ worker (local)

| | |
|--|--|
| Flags | Default **on** when `REDIS_URL` is set (`QUEUE_WORKER_V1`, `QUEUE_IMPORT_CHUNKS_V1`, `QUEUE_HEAVY_JOBS_V1`) |
| Worker | `REDIS_URL=redis://localhost:6379 npm run worker` (or `npm run build:worker && npm run worker:built`) |
| Full Compose | `docker compose --profile full up --build` (web + worker + postgres + redis) |
| Dispatch | `POST /api/cron/queue/dispatch` with `{ "job": "imap-sync" \| … }` and `Authorization: Bearer CRON_SECRET` |

See [`Architecture fixes plan/NOVA-CRM-P4-QUEUE-WORKER.md`](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md).

## Production Compose

Production VPS uses **immutable GHCR images** (never `docker compose up --build` on the server):

| File | Purpose |
|------|---------|
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | Postgres, Redis, Caddy, cron, service wiring |
| [`docker-compose.prod.images.yml`](../docker-compose.prod.images.yml) | Pins `web` / `worker` / `migrate` to `ghcr.io/<owner>/nova-crm-*:${NOVA_IMAGE_TAG}` |

Deploy flow (see [`VPS-SINGLE-SERVER-SETUP.md`](VPS-SINGLE-SERVER-SETUP.md)):

```bash
# On VPS after GitHub Actions approval (or manual with known SHA):
DEPLOY_REF=feature/remove-firebase DEPLOY_SHA=<git-sha> GHCR_OWNER=<org> ./scripts/deploy-vps.sh
```

**Never** deploy `main` to production VPS.

Full operator guide: [`VPS-SINGLE-SERVER-SETUP.md`](VPS-SINGLE-SERVER-SETUP.md).

## Checklist before pointing any script at a DB

- [ ] `DATABASE_URL` host is clearly local, staging, or prod — never ambiguous
- [ ] Script is not using a production credential from a non-production shell
- [ ] Migrations go through Prisma Migrate (or equivalent) via CI for shared envs — no manual `ALTER` on prod
- [ ] Any leftover ETL / reconcile jobs run against **staging** first

## Promotion flow (production)

```
feature/remove-firebase
    → PR + CI (lint, typecheck, test, build, migrate-smoke, docker build)
    → push: publish GHCR images tagged :<git-sha>
    → GitHub Actions "Deploy Production" + Environment approval
    → VPS: scripts/deploy-vps.sh (pull SHA → migrate → up --no-build → smoke)
```

`main` remains the **Firebase/reference** branch — not deployed to VPS. See [`docs/BRANCHING.md`](BRANCHING.md).
