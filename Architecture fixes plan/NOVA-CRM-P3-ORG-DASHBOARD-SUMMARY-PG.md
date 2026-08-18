# Phase 3 — Org dashboard summaries in Postgres (P3.1)

**Status:** Schema complete (2026-08-11)  
**Code:** `prisma/schema.prisma` → `OrgDashboardSummary` · migration `20260811200000_org_dashboard_summaries`  
**Firestore parity:** [`NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md`](NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md) · `src/lib/dashboard-summary.ts`

## Decision

Use a **tenant summary table** `org_dashboard_summaries` (one row per org), not a materialized view for the full KPI payload.

| Option | Why |
|--------|-----|
| **Table + background upsert (chosen)** | Matches Phase 0 writer model; supports gauges that still need Firestore entities (followups, reply-intel) until those land in Postgres; P3.2 can upsert without `REFRESH MATERIALIZED VIEW` coupling. |
| Full MV over `leads`/`deals` only | Incomplete vs P0.10 shape (followups / ranges / reply fields); revisit later for lead/deal-only slices if useful. |

## Table

| | |
|--|--|
| Name | `org_dashboard_summaries` |
| PK | `organization_id` (= Firestore org id / `organizations.id`) |
| FK | → `organizations(id)` ON DELETE CASCADE |
| RLS | FORCE; tenant via `app.organization_id`; bypass via `app.bypass_rls=on` |
| Grants | `nova_app` SELECT/INSERT/UPDATE/DELETE |

### Columns (v1)

Scalars mirror `OrgDashboardSummary` gauges. Nested maps live in JSONB:

| Column | Type | Maps to |
|--------|------|---------|
| `version` | int default 1 | `ORG_DASHBOARD_SUMMARY_VERSION` |
| `updated_at` | timestamptz | `updatedAt` ISO |
| `open_sales_leads` … `lead_estimate_contributors` | int / float | same field names (camelCase in TS) |
| `pipeline_by_stage` | jsonb `{}` | `pipelineByStage` |
| `channel_mix` | jsonb `{}` | `channelMix` |
| `funnel_by_channel` | jsonb `{}` | `funnelByChannel` |
| `ranges` | jsonb `{}` | `ranges` (`today` / `7d` / `30d` / `all`) |

## Out of scope for P3.1

- Background writer / queue refresh (**P3.2** — done; see below)
- Dashboard API read cutover flag (**P3.3** — done; see below)
- Dropping Firestore `orgDashboardSummaries` (**P3.4**)
- Ops scoreboards / mailbox / content-ops Redis caches (stay Phase 0 until separately migrated)

## P3.2 — Writer / refresh

| | |
|--|--|
| Flag | `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true` |
| Code | `src/lib/db/org-dashboard-summary-refresh.ts` |
| Trigger | Lead/deal CRM dual-write (`mirrorCrmEntityAfterWrite` / `mirrorCrmDocAfterWrite`) marks org dirty + `after()` refresh |
| Coalesce | Redis `dash:pg-summary:cooldown:v1:{orgId}` NX EX 60 (in-process fallback) |
| Dirty set | Redis `dash:pg-summary:dirty:v1` |
| Cron | `GET /api/cron/dashboard-summaries/refresh` · CF `refreshPostgresDashboardSummaries` (`* * * * *`) |
| Compute | Postgres leads/deals + Firestore followups (transitional) → upsert `org_dashboard_summaries` |
| Admin | Firestore `recomputeOrgDashboardSummaryServer` also mirrors to Postgres when flag on |

**Note:** Dirty drain currently hits App Hosting (same pattern as other light cron routes). Phase 4 moves this onto BullMQ + `Dockerfile.worker`.

## P3.3 — Dashboard read cutover

| | |
|--|--|
| Flag | `POSTGRES_DASHBOARD_SUMMARY_READ_V1=true` + `NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true` |
| Code | `src/lib/db/org-dashboard-summary-read.ts` · `GET /api/org/dashboard-summary` · `useOrgDashboardSummary` |
| Path | Redis `dash:summary:pg:v1:{orgId}` → Postgres `org_dashboard_summaries` (RLS via `withOrganizationScope`) |
| Client | Hook enables when **either** Phase 0 or P3.3 read flag is on |
| Cache | Writer upsert invalidates the PG Redis key |

## P3.4 — Firestore dependency removed (Postgres SoT)

| | |
|--|--|
| Read | When PG read flag is on: **no Firestore fallback** |
| Admin recompute | `POST /api/org/dashboard-summary/recompute` → `recomputeOrgDashboardSummaryPostgres` |
| FS writes | Opt-in only: `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1=true` |
| CF | `ORG_DASHBOARD_SUMMARY_STORE=postgres` (default) → `POST /api/cron/dashboard-summaries/recompute-org`; `firestore` / `dual` for rollback |
| Phase 0 read | `DASHBOARD_SUMMARIES_V1` kept as emergency Firestore read rollback |

## Soak checklist (post P3.4)

Do **not** flip flags on App Hosting until P3.4 code + migration are deployed to that backend.

1. **Local** — already ok if `.env.local` has:
   - `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true`
   - `POSTGRES_DASHBOARD_SUMMARY_READ_V1=true`
   - `NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true`
   - FS writer **unset** (`DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1` not `true`)
2. **App Hosting** — `apphosting.yaml` sets the three PG flags; leave `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1` unset. Redeploy after merge.
3. **Cloud Functions** — `functions/.env.novacrm-41ef8` has `ORG_DASHBOARD_SUMMARY_STORE=postgres` + existing `SITE_URL`. Confirm secret `CRON_SECRET` exists (`firebase functions:secrets:access CRON_SECRET`). Deploy: `npm run firebase:deploy:functions`.
4. **Migrate** — `org_dashboard_summaries` applied on the target Postgres (`npm run db:migrate:deploy` with that env’s `MIGRATE_DATABASE_URL`).
5. **Verify (day 0)**
   - `GET /api/org/dashboard-summary` → `source` is `postgres` (or redis-cached PG), `enabled: true`
   - Admin recompute succeeds; row present in `org_dashboard_summaries`
   - Create/update a lead → within ~60–90s summary refresh (dirty set / cron)
   - CF logs show notify to `/api/cron/dashboard-summaries/recompute-org` (not Firestore summary writes)
6. **Verify (few days)** — Overview KPIs (open/idle sales leads, pipeline $, stage mix) stay sane vs spot-checks; no spike of FS `orgDashboardSummaries` writes.

## Rollback

- P3.1: Drop migration / revert PR.
- P3.2: Unset `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1`.
- P3.3: Unset `POSTGRES_DASHBOARD_SUMMARY_READ_V1` / `NEXT_PUBLIC_…`.
- P3.4 emergency: set `ORG_DASHBOARD_SUMMARY_STORE=firestore` (or `dual`), `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1=true`, and Phase 0 `DASHBOARD_SUMMARIES_V1` read flags; unset PG read flag.
