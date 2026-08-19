# Nova CRM — Migration baby steps (runbook)

Working checklist for the architecture migration. One baby step ≈ one PR. Do not start the next phase until the previous phase exit criteria are met.

Source plan: implementation guide §4 + `ENGINEERING_RULES` / `NOVA-CRM-ENGINEERING-RULES.md`.

**Locked defaults:** Prisma + Migrate · Compose Postgres 16 + Redis 7 · Phase 5 auth = Clerk (P5.0 confirmed 2026-08-12) · two deployables only (web + worker).

---

## Week 0 — Foundation

| ID | Status | Notes |
|----|--------|-------|
| W0.1 | [x] | `AGENTS.md` loads canonical engineering rules |
| W0.2 | [x] | `docs/BRANCHING.md` — `feature/*` → PR → `main` |
| W0.3 | [x] | Root `Dockerfile`, `Dockerfile.worker`, `docker-compose.yml`, `.dockerignore` |
| W0.4 | [x] | Compose postgres + redis only; verified healthy (`pg_isready` + Redis `PONG`) on 5432/6379 |
| W0.5 | [x] | `npm run typecheck` + `.github/workflows/ci.yml` (lint warnings allowed for React Compiler debt) |
| W0.6 | [ ] | **Blocked:** GitHub Free private repo — protection API 403. Steps in `docs/BRANCHING.md` after Team/Pro |
| W0.7 | [x] | `docs/ENVIRONMENTS.md` — local/staging/prod never share DB/secrets |

**Week 0 exit:** CI on PRs, local Postgres+Redis healthy, Docker files at root, rules enforced. *(W0.6 pending GitHub Team/Pro for private-repo branch protection.)*

---

## Phase 0 — Redis-cached dashboard summaries (still Firebase)

Pain relief first; no data migration. Rule: no client-side aggregation of KPIs — see ENGINEERING_RULES §1 / §2.

| ID | Status | Notes |
|----|--------|-------|
| P0.1 | [x] | KPI inventory: [`NOVA-CRM-P0-DASHBOARD-KPI-INVENTORY.md`](NOVA-CRM-P0-DASHBOARD-KPI-INVENTORY.md) |
| P0.2 | [x] | `src/lib/cache/redis.ts` — get/set/del + 60s TTL; `REDIS_URL`; live test vs Compose Redis |
| P0.3 | [x] | Schema + types: [`NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md`](NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md) · `src/lib/dashboard-summary.ts` (not extending `activityCounters`) |
| P0.4 | [x] | `openSalesLeads` kept via CF `syncOpenSalesLeadsOnLeadWrite` + `dashboard-summary-server.ts`; admin recompute API |
| P0.5 | [x] | Flag `dashboard_summaries_v1` via `isDashboardSummariesV1Enabled()` (`DASHBOARD_SUMMARIES_V1` / `NEXT_PUBLIC_…`); default off |
| P0.6 | [x] | Open sales leads KPI reads summary/cache when flag on + org-wide scope; `GET /api/org/dashboard-summary` |
| P0.7 | [x] | Idle sales leads gauge on same summary path (CF + display override); recompute returns both |
| P0.8 | [x] | Open pipeline $ + openDealCount + leadEstimateContributors via CF recompute on lead/deal writes |
| P0.9 | [x] | Pipeline distribution (`pipelineByStage`) via same recompute; Overview uses summary when flag + org-wide |
| P0.10 | [x] | Full org summary: remaining §A scalars, `channelMix`, `funnelByChannel`, `ranges` (today/7d/30d/all); followup CF refresh |
| P0.11 | [x] | Mailbox util → Redis 60s; person task gauges (`dash:person:v1:…`) on summary GET |
| P0.12 | [x] | Reply-intel list Redis cache; content-ops summary API + ContentOpsBoard override |
| P0.13 | [x] | Team Command / Strategy / Inbox / Person scoreboards → `GET /api/org/ops-scoreboards` + Redis `dash:ops-scoreboards:v1:…` when flag + org-wide |

**Phase 0 exit:** Primary dashboard numbers from precomputed/cached sources; flag can roll back; Firebase read volume for dashboard drops.

---

## Phase 1 — Split heavy work off interactive web tier (still Firebase)

Rule: ENGINEERING_RULES §3 / §5 — do not block App Hosting with IMAP/import/scraper/scheduled-send bursts. Full ranked inventory: [`NOVA-CRM-P1-JOBS-INVENTORY.md`](NOVA-CRM-P1-JOBS-INVENTORY.md).

| ID | Status | Notes |
|----|--------|-------|
| P1.1 | [x] | Jobs/crons inventory ranked by hang risk — see companion doc; **#1 move = IMAP sync** |
| P1.2 | [x] | IMAP heads sync on Cloud Functions (`functions/src/inboxImapSync.ts`); AH only postprocess bounce/fanout. Rollback: `IMAP_SYNC_RUNTIME=apphosting` |
| P1.3 | [x] | Scheduled SMTP on CF (`scheduledEmailSend.ts`) + tracking + Sent APPEND; AH postprocess lead-mail/timeline/reply-intel. Rollback: `SCHEDULED_EMAIL_RUNTIME=apphosting` |
| P1.4 | [x] | Scrapers cron on CF (`scrapersRun.ts`); manual runs proxy via `runOrgScrapers` when `SCRAPERS_WORKER_URL` set. Rollback: `SCRAPERS_RUNTIME=apphosting` |
| P1.5 | [x] | Content-capture reminders on CF; MillionVerifier via CF worker proxy; import preview `maxDuration=300` (chunks already CF). Rollbacks: `CONTENT_CAPTURE_REMINDERS_RUNTIME` / `MILLIONVERIFIER_RUNTIME=apphosting` |

**Phase 1 exit:** Interactive App Hosting is not blocked by IMAP / scraper / scheduled-send / content-reminder bursts. (Import chunks, IMAP heads, scheduled SMTP, scrapers, and content-capture reminders run on Cloud Functions; MillionVerifier and manual scrapers proxy when worker URLs are set.)

---

## Phase 2 — Postgres + dual-write core CRM

ORM: **Prisma 7** + Migrate. Tenant key: `organization_id` + **RLS mandatory** before ship (P2.2+). Dependency order: `organizations → members → accounts → contacts → leads → deals`.

| ID | Status | Notes |
|----|--------|-------|
| P2.1 | [x] | Prisma 7 + `@prisma/adapter-pg`; `DATABASE_URL`; `prisma/migrations/20260811000000_init` (empty); `src/lib/db/prisma.ts`; scripts `db:generate` / `db:migrate` / `db:migrate:deploy` |
| P2.2 | [x] | `organizations` + `members` models; RLS + FORCE (`app.organization_id` / `app.bypass_rls`); `nova_app` runtime role (superuser bypass fix); `withOrganizationScope` / `withRlsBypass`; isolation tests; CI Postgres + migrate |
| P2.3 | [x] | Dual-write orgs/members behind `POSTGRES_DUAL_WRITE_ORGS_V1`; hooks in `organizations-server` / `members-server` (+ channelAdmin, open-join, intake filters/epoch, intent playbook); `src/lib/db/dual-write-orgs.ts` |
| P2.4 | [x] | Idempotent ETL `npm run db:backfill:orgs-members` (`scripts/backfill-orgs-members-to-postgres.ts` + `src/lib/db/etl-orgs-members.ts`); `--dry-run` / `--org=` / `--limit=`; reuses P2.3 upserts |
| P2.5 | [x] | Reconcile `npm run db:reconcile:orgs-members` (`scripts/reconcile-orgs-members.ts` + `src/lib/db/reconcile-orgs-members.ts`); counts + missing rows + sample field diffs; exit 1 if not clean |
| P2.6 | [x] | Accounts: schema+RLS, dual-write (`POSTGRES_DUAL_WRITE_CRM_V1` + `/api/org/crm-mirror` + client persist hooks), ETL/reconcile via `db:backfill:crm` / `db:reconcile:crm` |
| P2.7 | [x] | Contacts: same shared CRM pipeline (FK-friendly columns, no hard inter-entity FKs yet) |
| P2.8 | [x] | Leads: same + promote/Instantly server mirrors |
| P2.9 | [x] | Deals: schema+RLS+patch dual-write (creates still session-only in UI — ETL covers existing FS deals) |
| P2.10 | [x] | Leads list read cutover behind `POSTGRES_READ_LEADS_V1` (+ `NEXT_PUBLIC_…`); `GET /api/org/leads` + `listLeadsFromPostgres` (RLS); workspace poll when flag on, Firestore when off |

**Phase 2 exit:** Core CRM entities dual-written, reconciled in staging; at least one read path on Postgres behind a flag.

---

## Phase 3 — Dashboard reads from Postgres

Rule: ENGINEERING_RULES §1 — KPIs from precomputed summaries, not client aggregation. Replaces Phase 0 Firestore `orgDashboardSummaries` over time.

| ID | Status | Notes |
|----|--------|-------|
| P3.1 | [x] | Table `org_dashboard_summaries` + RLS + `nova_app` grants; Prisma model `OrgDashboardSummary`; mapper `src/lib/db/org-dashboard-summary-postgres.ts`; schema note [`NOVA-CRM-P3-ORG-DASHBOARD-SUMMARY-PG.md`](NOVA-CRM-P3-ORG-DASHBOARD-SUMMARY-PG.md) |
| P3.2 | [x] | Writer flag `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1`; recompute from PG leads/deals (+ FS followups); Redis dirty-set + ~60s cooldown; hooked from CRM dual-write; cron `GET /api/cron/dashboard-summaries/refresh` + CF `refreshPostgresDashboardSummaries` |
| P3.3 | [x] | Read flag `POSTGRES_DASHBOARD_SUMMARY_READ_V1` (+ `NEXT_PUBLIC_…`); `GET /api/org/dashboard-summary` prefers Redis→Postgres (RLS); client hook enables on either Phase 0 or P3.3 flag (FS fallback removed in P3.4) |
| P3.4 | [x] | Postgres SoT for org KPI summaries: no FS fallback on PG read; admin recompute → PG; FS writes opt-in `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1`; CF `ORG_DASHBOARD_SUMMARY_STORE=postgres` → `POST /api/cron/dashboard-summaries/recompute-org` |

**Phase 3 exit:** Dashboard metrics served from Postgres precompute, not client aggregation or Firestore scans. ✓

---

## Phase 4 — Real queue + worker tier

Rule: ENGINEERING_RULES §3 / §5 — web and worker are separate deployables; heavy work only on the worker. Companion: [`NOVA-CRM-P4-QUEUE-WORKER.md`](NOVA-CRM-P4-QUEUE-WORKER.md).

| ID | Status | Notes |
|----|--------|-------|
| P4.1 | [x] | BullMQ + `ioredis` on `REDIS_URL`; `src/lib/queue/connection.ts` + `queues.ts`; live Queue vs Compose Redis |
| P4.2 | [x] | `src/worker/index.ts` + `npm run build:worker` (esbuild) → `dist/worker/index.js`; hello job + `/healthz` |
| P4.3 | [x] | Import chunks: confirm enqueues; worker applies via `prospect-import-chunk-apply`; CF trigger skipped when `QUEUE_IMPORT_CHUNKS_V1` |
| P4.4 | [x] | IMAP / scheduled email / scrapers / reminders / dashboard drain enqueue via `/api/cron/queue/dispatch` + AH cron helpers when `QUEUE_HEAVY_JOBS_V1` |
| P4.5 | [x] | Per-tenant Redis sliding window + worker limiter + priority lanes (`src/lib/queue/fairness.ts`) |
| P4.6 | [x] | Next `output: 'standalone'`; Compose `web`/`worker` (profile `full`); `/api/health` |

**Phase 4 exit:** Web and worker are separate deployables; background work only on worker when queue flags are on. ✓

**Local soak (2026-08-11):** `npx tsx scripts/soak-phase4-queue.ts` passed — hello + dashboard consumed by worker; import enqueue lands on `nova-import-chunks`; HTTP `/api/cron/queue/dispatch` and dashboard refresh return `queued:true` (no inline heavy drain). Requires `QUEUE_*` + `CRON_SECRET` + `npm run worker` + `npm run dev`.

---

## Phase 5 — Auth migration (Clerk)

Rule: ENGINEERING_RULES — not Firebase Auth; httpOnly / server-verified session. Companion: [`NOVA-CRM-P5-AUTH-CLERK.md`](NOVA-CRM-P5-AUTH-CLERK.md).

| ID | Status | Notes |
|----|--------|-------|
| P5.0 | [x] | Clerk confirmed; Organizations off (Nova owns tenants); env vars documented in companion |
| P5.1 | [x] | `@clerk/nextjs`; flag `auth_clerk_v1`; OptionalClerkProvider; `/sign-in` `/sign-up`; proxy `clerkMiddleware` when flag on; Firebase path when off |
| P5.2 | [x] | Map Clerk user ↔ member ↔ `organization_id` via externalId + email (`resolveClerkIdentity`) |
| P5.3 | [x] | Clerk preferred in `getVerifiedSession` / `requireTenantSession`; Firebase cookie secondary |
| P5.4 | [x] | Invite/join via Clerk + `clerk-complete-membership`; onboarding syncs Clerk metadata; links use `/sign-up` |
| P5.5 | [x] | `/login` `/signup` redirect to Clerk; Firebase Auth unused for web login (custom-token bridge remains for Firestore) |

**Phase 5 exit:** Auth is Clerk; Firebase Auth unused for web login.

---

## Phase 6 — Decommission Firebase (CRM data path)

Rule: ENGINEERING_RULES — PostgreSQL is DB of record; no Firestore for CRM transactional data after exit. Companion: [`NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](NOVA-CRM-P6-DECOMMISSION-FIREBASE.md).

**Gate before sole-writer cutover:** dual-write flags on in the target env, `db:reconcile:crm` (+ orgs/members) clean, and workspace **reads** for the six CRM entities on Postgres (leads already = P2.10; accounts/contacts/deals = P6.1).

| ID | Status | Notes |
|----|--------|-------|
| P6.0 | [x] | Inventory + gate checklist in companion; Phase 6 checkboxes expanded |
| P6.1 | [x] | PG read cutover for **accounts / contacts / deals** behind `postgres_read_crm_v1`; APIs + workspace poll; profiles stay FS |
| P6.2 | [x] | CRM sole writer flag `postgres_sole_writer_crm_v1` + `POST /api/org/crm-write`; client persist skips FS when on. **Orgs/members still FS** (need PG reads first) |
| P6.3 | [x] | Firestore CRM archive script `npm run db:export:firestore-crm` → `archives/` (gitignored); companion runbook + optional gcloud managed export |
| P6.4 | [x] | Admin CRM writers (promote, Instantly) + client gaps (bulk reassign, activity bump) respect sole-writer → PG; CRM listeners already skipped when read flags on; **bridge kept** for non-CRM FS |
| P6.5 | [x] | ENGINEERING_RULES §1b: Firebase residual exception for non-CRM domains; CRM SoT = Postgres when flags on; packages **not** removed yet |

**Phase 6 exit:** PostgreSQL is system of record for CRM entities; Firebase decommissioned for CRM (auth already Clerk).

---

## Phase 7 — Complete Firebase removal (zero dependency)

Rule: ENGINEERING_RULES §1 — PostgreSQL is the only DB of record; no Firestore, no Firebase Auth, no Cloud Functions.

| ID | Status | Notes |
|----|--------|-------|
| P7.0 | [x] | Full Firestore archive (`npm run db:export:firestore-crm -- --full`); CI import gate `scripts/check-firebase-imports.mjs` |
| P7.1 | [x] | Collapse CRM cutover flags; Postgres sole writer always on; dual-write flags off |
| P7.2 | [x] | Orgs/members/invites Postgres sole-writer (`org_invites` + member/org tables) |
| P7.3 | [x] | Imports, prospect drafts, extension, scrapers → Postgres (`pg_documents` + worker) |
| P7.4 | [x] | Email domain (IMAP, bounce/reply, scheduled send, MillionVerifier) → Postgres |
| P7.5 | [x] | Workspace satellite entities → Postgres APIs (`/api/org/workspace-documents`) |
| P7.6 | [x] | Content calendar + AI/RAG (`ai_document_embeddings` + pgvector; cosine fallback) |
| P7.7 | [x] | Notifications + chat realtime (Redis pub/sub + SSE `/api/realtime/stream`) |
| P7.8 | [x] | Clerk→Firebase bridge removed; login/signup/extension-login redirect to Clerk |
| P7.9 | [x] | `functions/` + firebase config + npm packages deleted; ENGINEERING_RULES §1b closed |
| P7.10 | [x] | `docker-compose.prod.yml`, migrate container, cron, CI Docker builds, backup scripts |

**Phase 7 exit:** `rg -i firebase` returns nothing required by production; app runs on Clerk + Postgres + Redis + worker only.

---

## Cross-cutting (still applies)

- Migrations via Prisma only · RLS on every tenant table · staging ≠ prod secrets · feature flags for cutovers · small revertable PRs
