# Environments — separation rules

Migration step **W0.7**. Expands
[`Architecture fixes plan/nova-crm-implementation-guide.md`](../Architecture%20fixes%20plan/nova-crm-implementation-guide.md) §5
and [`NOVA-CRM-ENGINEERING-RULES.md`](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) §3
(“Staging never touches production data”).

**Signed off:** 2026-08-10 — local / staging / production must never share a database or production secrets.

## The three environments

| Environment | Purpose | Data | Deploys |
|-------------|---------|------|---------|
| **Local / dev** | Individual development | Compose Postgres + Redis (`docker compose up -d postgres redis`); seed/fake data only | Manual (`npm run dev`) |
| **Staging** | Pre-production validation, QA, demos | Realistic but **not** real customer data (synthetic or scrubbed) | Automatic on merge to `main` (once deploy pipeline exists) |
| **Production** | Real customers | Real | Manual-gated, tagged releases only |

## Hard rules (non-negotiable)

1. **Separate cloud projects/accounts per environment** — not folders inside one project.
2. **Separate databases entirely** — different Postgres instances, credentials, and network access. Never point staging (or local) at prod “just to test.”
3. **Separate Redis / cache** — local Compose Redis is for local only; staging and prod use their own managed Redis.
4. **Separate secrets** — production secrets must not be readable from staging or laptop `.env` files committed to git. Use each environment’s secrets manager / GitHub Environments.
5. **Separate third-party sandboxes where it matters** — email senders, AI providers, verification APIs: staging keys must not burn production quotas or touch real customer inboxes.

## Local defaults (Compose)

| Service | URL / connection |
|---------|------------------|
| Postgres 16 | Superuser (migrate): `postgres://nova:nova_dev_password@localhost:5432/nova_crm` · App (RLS): `postgres://nova_app:nova_dev_password@localhost:5432/nova_crm` |
| Redis 7 | `redis://localhost:6379` |

Set in local `.env.local` (see `.env.example`):

- `DATABASE_URL` — app role `nova_app` (Prisma Client / RLS enforced)
- `MIGRATE_DATABASE_URL` — Compose superuser `nova` (Prisma Migrate DDL)
- `REDIS_URL` — Phase 0 cache helper (`src/lib/cache/redis.ts`)

These credentials are **dev-only**. Do not reuse them in staging or production.

Local migrate (P2.1+): `docker compose up -d postgres` then `npm run db:migrate:deploy` (or `npm run db:migrate` when adding models).

Tenant queries (P2.2+): use `withOrganizationScope(orgId, …)` from `src/lib/db/tenant-scope.ts` so Postgres RLS (`app.organization_id`) applies. Use `withRlsBypass` only for platform/ETL paths.

Org/member dual-write (P2.3): set `POSTGRES_DUAL_WRITE_ORGS_V1=true` to mirror Firestore org/member writes into Postgres after success (Firestore remains source of truth).

Org/member backfill (P2.4): `npm run db:backfill:orgs-members -- --dry-run` then without `--dry-run`. Options: `--org=<id>`, `--limit=<n>`. Staging first — never production from a laptop.

Org/member reconcile (P2.5): `npm run db:reconcile:orgs-members` (optional `--org=` / `--sample=`). Exit 0 only when counts match and there are no missing rows or field diffs.

CRM entities (P2.6–P2.9): set `POSTGRES_DUAL_WRITE_CRM_V1=true` for live mirrors. Backfill/reconcile:
`npm run db:backfill:crm -- --dry-run` then without `--dry-run`; `npm run db:reconcile:crm`.

Leads list read cutover (P2.10): set `POSTGRES_READ_LEADS_V1=true` and `NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=true` so the workspace leads list uses `GET /api/org/leads` (Postgres + RLS) instead of Firestore `onSnapshot`. Flag off = Firestore. Requires a clean CRM backfill/reconcile first. Client polls every **60s** with an in-flight guard; API pages internally (`all=1`) and strips heavy payload blobs.

Optional pool tuning: `PG_POOL_MAX` (default 10) for the Prisma `pg` pool.

Postgres dashboard summary writer (P3.2): set `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true` so lead/deal dual-writes mark the org dirty and refresh `org_dashboard_summaries` (debounced ~60s). Cron drain: `GET /api/cron/dashboard-summaries/refresh` with `Authorization: Bearer CRON_SECRET` (Cloud Functions `refreshPostgresDashboardSummaries` every minute). Requires `DATABASE_URL`; Redis recommended for dirty-set coalesce.

Postgres dashboard summary read (P3.3/P3.4): set `POSTGRES_DASHBOARD_SUMMARY_READ_V1=true` and `NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true` so `GET /api/org/dashboard-summary` reads Postgres only (+ Redis `dash:summary:pg:v1:…`). No Firestore fallback when this flag is on.

P3.4 SoT: admin `POST /api/org/dashboard-summary/recompute` writes Postgres. Firestore `orgDashboardSummaries` writes require opt-in `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1=true`. Cloud Functions use `ORG_DASHBOARD_SUMMARY_STORE=postgres` (default) → `POST /api/cron/dashboard-summaries/recompute-org`; set `firestore` or `dual` only for rollback.

Phase 0 `DASHBOARD_SUMMARIES_V1` remains a **read rollback** to Firestore summaries.

## Phase 4 — BullMQ worker (local)

| | |
|--|--|
| Flags | `QUEUE_WORKER_V1=true` plus `QUEUE_IMPORT_CHUNKS_V1` and/or `QUEUE_HEAVY_JOBS_V1` |
| Worker | `REDIS_URL=redis://localhost:6379 npm run worker` (or `npm run build:worker && npm run worker:built`) |
| Full Compose | `docker compose --profile full up --build` (web + worker + postgres + redis) |
| Dispatch | `POST /api/cron/queue/dispatch` with `{ "job": "imap-sync" \| … }` and `Authorization: Bearer CRON_SECRET` |

See [`Architecture fixes plan/NOVA-CRM-P4-QUEUE-WORKER.md`](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md).

## Checklist before pointing any script at a DB

- [ ] `DATABASE_URL` host is clearly local, staging, or prod — never ambiguous
- [ ] Script is not using a production credential from a non-production shell
- [ ] Migrations go through Prisma Migrate (or equivalent) via CI for shared envs — no manual `ALTER` on prod
- [ ] Dual-write / ETL / reconcile jobs run against **staging** first

## Promotion flow (target)

```
feature/* → PR → CI (lint, typecheck, test, build) → merge to main
                                                      → staging deploy
                                                      → tag v* + approval
                                                      → production deploy
```

See also [`docs/BRANCHING.md`](BRANCHING.md).
