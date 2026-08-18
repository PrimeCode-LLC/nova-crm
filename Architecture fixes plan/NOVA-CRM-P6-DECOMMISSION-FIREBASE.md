# Phase 6 — Decommission Firebase (CRM data path)

Companion to [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](NOVA-CRM-MIGRATION-BABY-STEPS.md). Rule: ENGINEERING_RULES — PostgreSQL (+ RLS) is DB of record; Firebase is not for CRM transactional data after Phase 6 exit.

## P6.0 — Gate (recorded 2026-08-12)

### Preconditions

| Check | Status |
|-------|--------|
| Phase 5 exit (Clerk web login) | Met |
| Prisma models for orgs/members/accounts/contacts/leads/deals + dashboard summary | Present |
| Dual-write flags exist (`POSTGRES_DUAL_WRITE_ORGS_V1`, `POSTGRES_DUAL_WRITE_CRM_V1`) | Present (must be **on** in cutover env) |
| Leads PG read (`POSTGRES_READ_LEADS_V1`) | Available (P2.10) |
| Accounts/contacts/deals PG read | **P6.1** (this phase) |
| `npm run db:reconcile:crm` (+ orgs/members) clean on target env | Required before **P6.2** |
| Non-CRM Firestore domains (chat, email, scrapers, …) | Out of sole-writer scope — stay FS until later exceptions / follow-on |

### Scope of “CRM entities” for P6.1–P6.2

`organizations`, `members`, `accounts`, `contacts`, `leads`, `deals` (+ dashboard summaries already on Postgres from Phase 3).

### Remaining Firestore surface (inventory)

| Category | Examples | Phase 6 action |
|----------|----------|----------------|
| **CRM dual-written** | accounts, contacts, leads, deals, orgs, members | Read cutover → stop writes → drop listeners |
| **Dashboard** | `orgDashboardSummaries` | Already PG SoT (P3.4); FS writer opt-in only |
| **Auth bridge** | Clerk→Firebase custom token | Remove in **P6.4** after CRM listeners gone |
| **Realtime / collab** | workspace chat, userNotifications | Keep until dedicated migration (exception) |
| **Jobs / email / scrapers** | importJobs, scraper*, mailbox, meetings, … | Keep until entity-by-entity follow-on |
| **Platform** | platformAdmins, extension*, auditLog | Keep / migrate separately |

Full collection list: `src/lib/firestore/collections.ts` (~60+ ids). Prisma covers **7** models only.

### Cutover order

1. **P6.1** — Flag-gated PG reads for accounts/contacts/deals (workspace).
2. Soak + reconcile clean.
3. **P6.2** — Postgres sole writer (stop FS CRM writes / dual-write mirrors).
4. **P6.3** — Final Firestore export archive.
5. **P6.4** — Strip CRM FS listeners, Admin CRM writers, Firebase bridge.
6. **P6.5** — Drop Firebase deps after production soak (weeks).

### Rollback

| Step | Rollback |
|------|----------|
| P6.1 | Set `POSTGRES_READ_CRM_V1` / `NEXT_PUBLIC_…` off → Firestore `onSnapshot` resumes |
| P6.2 | Re-enable dual-write + FS write paths (feature flags); do **not** delete FS data until P6.5 |
| P6.4+ | Restore bridge / listeners from git; keep export from P6.3 |

## P6.1 — Postgres read: accounts / contacts / deals

| Item | Detail |
|------|--------|
| Flag | `postgres_read_crm_v1` via `POSTGRES_READ_CRM_V1` + `NEXT_PUBLIC_POSTGRES_READ_CRM_V1` |
| APIs | `GET /api/org/accounts`, `/api/org/contacts`, `/api/org/deals` (RLS + optional member narrow) |
| Lib | `src/lib/db/list-crm-postgres.ts`, `postgres-read-crm-flags.ts` |
| Client | `use-live-workspace-firestore` polls when flag on (`directory` + `deals` groups); **profiles** stay on Firestore |
| Default | **Off** (Firestore listeners) |
| Status | **Implemented** (2026-08-12) |

## P6.2 — Postgres sole writer (CRM client paths)

| Item | Detail |
|------|--------|
| Flag | `postgres_sole_writer_crm_v1` via `POSTGRES_SOLE_WRITER_CRM_V1` + `NEXT_PUBLIC_…` |
| API | `POST /api/org/crm-write` — `upsert` / `patch` / `delete` / `upsert_graph` (RLS) |
| Lib | `crm-write-postgres.ts`, `crm-write-client.ts`, `postgres-sole-writer-crm-flags.ts` |
| Client | `persist-*-client` helpers skip Firestore when flag on |
| Scope | accounts / contacts / leads / deals **client** persist only |
| Not yet | orgs/members sole writer; Admin/server writers (promote, Instantly, imports, email); deal UI creates (`useLocalDeals`) |
| Default | **Off** |
| Status | **Implemented** (2026-08-12) — enable only after reconcile clean + read flags on |

### Enable checklist

1. `POSTGRES_DUAL_WRITE_CRM_V1=true` (soak) + `npm run db:reconcile:crm` clean  
2. `POSTGRES_READ_LEADS_V1` + `POSTGRES_READ_CRM_V1` (+ `NEXT_PUBLIC_*`) on  
3. Then set sole-writer flags on and restart  
4. Rollback: turn sole-writer flags off (FS writes resume; dual-write can catch up)

## P6.3 — Archive final Firestore export

| Item | Detail |
|------|--------|
| Script | `npm run db:export:firestore-crm` → `scripts/export-firestore-crm-archive.ts` |
| Lib | `src/lib/db/export-firestore-crm-archive.ts` |
| Output | `archives/firestore-crm-<timestamp>/` (gitignored) — one `.jsonl` per collection + `manifest.json` |
| Default scope | organizations, members, accounts, contacts, leads, deals, orgDashboardSummaries |
| Flags | `--dry-run`, `--org=ID`, `--full` (all tenant collections + users), `--limit=N`, `--out=PATH` |
| Status | **Implemented** (2026-08-12) |

### Local / staging run

```bash
# Smoke (counts only)
npm run db:export:firestore-crm -- --dry-run

# One org
npm run db:export:firestore-crm -- --org=YOUR_ORG_ID

# Full CRM core archive
npm run db:export:firestore-crm

# Broader insurance export
npm run db:export:firestore-crm -- --full
```

Requires `FIREBASE_ADMIN_*` in `.env.local`. Copy the `archives/…` folder to durable object storage (S3/GCS/R2) and retain for a few months before P6.5.

### Production managed export (recommended for large datasets)

App JSONL is fine for CRM core. For a full project snapshot, use Google’s managed export (needs a GCS bucket in the same project):

```bash
gcloud config set project YOUR_FIREBASE_PROJECT_ID
gcloud firestore export gs://YOUR_BACKUP_BUCKET/firestore-$(date -u +%Y%m%d)
```

Document the bucket path + date in the ops runbook; do not commit exports.

## P6.4 — Strip CRM Firestore writes (incremental)

| Item | Detail |
|------|--------|
| Already done (P6.1) | Workspace skips FS `onSnapshot` for accounts/contacts/leads/deals when read flags on |
| Admin | `promote-server`, Instantly `webhook-handler` + `sync-campaign-leads-server` write PG when sole-writer on |
| Client gaps | `persist-bulk-owner-reassign-client`, `persistLeadActivityBump` → `/api/org/crm-write` |
| Helpers | `crm-sole-writer-server.ts`, get/find helpers on `list-crm-postgres.ts`, `bump_lead_activity` action |
| Bridge | **Kept** — chat, notifications, profiles, followups, etc. still need Firebase Auth for rules |
| Remaining FS CRM writers | imports chunk apply, email bounce/reply patches, millionverifier, extension findings, prospects draft/push — follow-on |
| Status | **Implemented** (2026-08-14) for primary Admin + client paths |

## P6.5 — Firebase deps / exception

| Item | Detail |
|------|--------|
| Decision | Do **not** remove `firebase` / `firebase-admin` while non-CRM domains remain on Firestore |
| Contract | ENGINEERING_RULES **§1b** — CRM SoT = Postgres; Firebase allowed only for listed residual domains |
| Exit meaning | CRM transactional path decommissioned (flags + writers), not empty Firebase |
| Status | **Recorded** (2026-08-14) |

### Follow-on (out of this baby step)

- Orgs/members PG reads → sole writer  
- Remaining Admin CRM patches (email, MV, imports, extension, prospects)  
- Per-domain migration off Firestore → then drop bridge → then drop packages  

