# Nova CRM (Relay)

Next.js 16 **App Router** sales CRM. **Architecture:** PostgreSQL (RLS) + Redis + two deployables (**web** + **worker**). **Auth:** Clerk (identity) with Nova-owned tenancy. Binding rules: [`Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md). Migration checklist: [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md).

## Current architecture

There are **two app deployables** (not separate frontend/backend microservices):

| Deployable | Image | Role |
|------------|--------|------|
| **Web** | `Dockerfile` | Next.js UI + API routes (interactive traffic only) |
| **Worker** | `Dockerfile.worker` | BullMQ consumer — imports, IMAP, scheduled email, scrapers, reminders, dashboard refresh |

Local infra is Compose **Postgres 16** + **Redis 7**. Default `docker compose up` starts infra only; web/worker are under Compose profile `full`.

```mermaid
flowchart LR
  browser[Browser] --> web[Web_Next.js]
  web --> clerk[Clerk_Auth]
  web --> pg[(Postgres_RLS)]
  web --> redis[(Redis)]
  web -->|enqueue| redis
  redis --> worker[Worker_BullMQ]
  worker --> pg
  worker --> redis
  web -.->|residual_non_CRM| fs[(Firestore)]
```

| Concern | System of record (when cutover flags are on) |
|---------|-----------------------------------------------|
| **Auth (web login)** | **Clerk** — `/sign-in`, `/sign-up`; Nova maps identity → `organization_id` / role |
| **CRM entities** | **Postgres** — accounts, contacts, leads, deals (+ org dashboard summaries) |
| **CRM writes** | **Sole writer** via `POST /api/org/crm-write` — no Firestore dual-write on that path |
| **Orgs / members** | Still Firestore-first writers (Postgres dual-write optional for migration soak) |
| **Firebase residual** | Chat, notifications, email/mailbox, scrapers intake, imports metadata, scheduling, etc. — see ENGINEERING_RULES §1b |
| **Clerk → Firebase bridge** | Custom token so remaining Firestore client listeners keep Auth rules until those domains migrate |

Heavy work must not run on the web tier when queue flags are on — see [`NOVA-CRM-P4-QUEUE-WORKER.md`](Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md).

Env / flag details: [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md). Tenant model: [`docs/SAAS-ARCHITECTURE.md`](docs/SAAS-ARCHITECTURE.md) (Firestore-shaped; CRM reads/writes move to Postgres under Phase 6 flags).

## Branching

Work on `feature/*` branches and merge to `main` via PR only — see [`docs/BRANCHING.md`](docs/BRANCHING.md). Do not push directly to `main`.

## Quick start

```bash
cd crm
npm install
cp .env.example .env.local
# Fill Clerk keys + AUTH_CLERK_V1 (see Auth below)
# Keep FIREBASE_ADMIN_* for residual Firestore + Clerk→Firebase bridge
# Set DATABASE_URL / MIGRATE_DATABASE_URL / REDIS_URL (see Docker section)
docker compose up -d postgres redis
npm run db:migrate:deploy   # first time / after pulling migrations
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors go to Clerk **`/sign-in`** when `auth_clerk_v1` is on.

### Recommended local cutover flags (CRM on Postgres)

After backfill/reconcile are clean for your org:

```bash
# Auth
AUTH_CLERK_V1=true
NEXT_PUBLIC_AUTH_CLERK_V1=true

# CRM reads (workspace polls APIs instead of Firestore onSnapshot)
POSTGRES_READ_LEADS_V1=true
NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=true
POSTGRES_READ_CRM_V1=true
NEXT_PUBLIC_POSTGRES_READ_CRM_V1=true

# CRM writes — Postgres only (no dual-write on client/Admin sole-writer paths)
POSTGRES_SOLE_WRITER_CRM_V1=true
NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1=true

# Dashboard KPIs from Postgres precompute
POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true
POSTGRES_DASHBOARD_SUMMARY_READ_V1=true
NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true
```

Dual-write flags (`POSTGRES_DUAL_WRITE_*`) were the **Phase 2 migration bridge**. With sole-writer on, do **not** rely on dual-write for accounts/contacts/leads/deals — Postgres is the writer. Keep dual-write off unless you are actively soaking a new environment before sole-writer cutover.

### Local worker (Phase 4)

With Redis up and `REDIS_URL` in `.env.local`:

```bash
# Optional queue cutover (defaults off — CF/AH paths remain):
# QUEUE_WORKER_V1=true
# QUEUE_IMPORT_CHUNKS_V1=true
# QUEUE_HEAVY_JOBS_V1=true
npm run worker
```

Health: `http://127.0.0.1:8081/healthz`. Full containerized stack (web + worker + infra):

```bash
docker compose --profile full up --build
```

### Local Docker (Postgres + Redis)

```bash
docker compose up -d postgres redis
# Wait until healthy, then in .env.local:
# DATABASE_URL=postgres://nova_app:nova_dev_password@localhost:5432/nova_crm
# MIGRATE_DATABASE_URL=postgres://nova:nova_dev_password@localhost:5432/nova_crm
# REDIS_URL=redis://localhost:6379
```

Env separation rules: [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md).

### UI-only dev (no auth)

If you have not configured Clerk yet, either:

1. Set **`NEXT_PUBLIC_AUTH_DISABLED=true`** and **`DISABLE_AUTH=true`** in `.env.local` to skip auth and middleware (mock sidebar user), or  
2. Configure Clerk (recommended) so `/sign-in` / `/sign-up` work end-to-end.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client + server | Clerk browser SDK |
| `CLERK_SECRET_KEY` | Server | Clerk API / session verification |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Client | Default `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Client | Default `/sign-up` |
| `AUTH_CLERK_V1` / `NEXT_PUBLIC_AUTH_CLERK_V1` | Server / client | Enable Clerk auth path |
| `DATABASE_URL` | Server | App role `nova_app` (RLS enforced) |
| `MIGRATE_DATABASE_URL` | CLI | Superuser for Prisma Migrate |
| `REDIS_URL` | Server / worker | Cache + BullMQ |
| `FIREBASE_ADMIN_*` | Server | Residual Firestore + custom-token bridge |
| `NEXT_PUBLIC_FIREBASE_*` | Client | Residual Firestore client / bridge |
| `PLATFORM_ADMIN_EMAILS` | Server | Bootstrap operators for `/platform` |
| `SYSTEM_SMTP_*` / `RESEND_*` | Server | Transactional mail (invites, setup links) |
| `NEXT_PUBLIC_SITE_URL` | Server / client | Origin used in invite / OAuth redirects |
| `CRON_SECRET` | Server / CF | Bearer auth for cron + queue dispatch |
| `DISABLE_AUTH` / `NEXT_PUBLIC_AUTH_DISABLED` | Server / Edge | Local UI-only; never production |

Postgres cutover flags (see Quick start + [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md)):

| Flag | Role |
|------|------|
| `POSTGRES_READ_LEADS_V1` (+ `NEXT_PUBLIC_…`) | Leads list from Postgres |
| `POSTGRES_READ_CRM_V1` (+ `NEXT_PUBLIC_…`) | Accounts / contacts / deals from Postgres |
| `POSTGRES_SOLE_WRITER_CRM_V1` (+ `NEXT_PUBLIC_…`) | CRM client/Admin writes → Postgres only |
| `POSTGRES_DASHBOARD_SUMMARY_*` | KPI summary writer/read on Postgres |
| `POSTGRES_DUAL_WRITE_*` | **Legacy migration soak only** — not needed once sole-writer is on |
| `QUEUE_WORKER_V1` / `QUEUE_*_V1` | Route heavy jobs to BullMQ worker |

See `.env.example` for the full list.

## Auth & multi-tenant flow

**Clerk is the web login provider** (Phase 5). Nova owns tenancy — Clerk Organizations stay **off**. See [`NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md).

1. User signs in at **`/sign-in`** or signs up at **`/sign-up`** (Clerk UI).
2. Server resolves Clerk user → Nova `uid` / `organizationId` / `orgRole` via `externalId` + email (`resolveClerkIdentity`).
3. Invite / open-join tokens are stashed across Clerk UI; `POST /api/auth/clerk-complete-membership` attaches membership.
4. Onboarding (`/onboarding`) covers signed-in users without an org; syncs Clerk `publicMetadata`.
5. While Firestore listeners remain for non-CRM domains, the client uses **`POST /api/auth/clerk-firebase-bridge`** (custom token) so Firebase Auth rules still work — not for interactive password login.

**Sign out** clears Nova session state and Clerk (`clerk-sign-out-bridge`).

**Platform admins** still use `PLATFORM_ADMIN_EMAILS` + `platformAdmins` against the bridged Nova uid/email.

**Chrome extension** remains on its own auth exchange path for now (follow-up after web cutover).

Legacy `/login` and `/signup` redirect to Clerk when the flag is on.

## CRM data path (Postgres, no dual-write)

With read + sole-writer flags on:

| Action | Path |
|--------|------|
| List accounts / contacts / leads / deals | `GET /api/org/{accounts\|contacts\|leads\|deals}` (RLS) |
| Create / patch / delete / graph upsert | `POST /api/org/crm-write` |
| Dashboard KPIs | `GET /api/org/dashboard-summary` → Postgres + Redis |
| Archive old Firestore CRM | `npm run db:export:firestore-crm` |

Tenant-scoped queries use `withOrganizationScope` (`src/lib/db/tenant-scope.ts`). Details: [`NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md).

## Org management

- **`/admin/team`** — owner / admin invite teammates, change roles, disable members. Talks to `/api/org/members` and `/api/org/invites`.
- **`/admin/users`** — legacy demo view of the org chart (mock data).
- **`/platform`** — operator console (gated by `platformAdmins` or `PLATFORM_ADMIN_EMAILS`).

## Website → CRM webhook

`POST /api/integrations/webhook/lead` with header **`Authorization: Bearer <secret>`** or **`x-webhook-secret: <secret>`**.

The body MUST include `organizationId`. The secret is checked against the org’s inbound webhook secret with `INBOUND_WEBHOOK_SECRET` as a legacy fallback.

```json
{
  "organizationId": "abc123",
  "source": "website",
  "contactEmail": "lead@example.com",
  "contactName": "Jane Doe",
  "companyName": "Acme",
  "channel": "website_form",
  "raw": {}
}
```

## Social RSS scrapers

- **Admin → Scrapers** (`/admin/scrapers`): manage rss.app feed URLs, seed default feeds, run feeds manually.
- **Intake pool** (`/intake`): browse posts, promote to prospect, or dismiss.
- Scheduled ingest: set `CRON_SECRET` on App Hosting and Cloud Functions; CF `runDueScrapers` every 15 minutes. Prefer queue worker when `QUEUE_HEAVY_JOBS_V1` is on.

## Cloud Functions (residual / transitional)

Located in `functions/`. Build:

```bash
cd functions && npm install && npm run build
```

Still used for IMAP heads, scheduled SMTP, scrapers cron, content-capture reminders, and related postprocess hooks until fully cut over to the BullMQ worker. Deploy: `npm run firebase:deploy:functions` from `crm/`.

## Firebase residual surface

Firebase remains in the repo for **non-CRM** domains (ENGINEERING_RULES §1b). Do not add new Firestore collections for accounts/contacts/leads/deals when sole-writer is on.

| File | Purpose |
|------|---------|
| `firebase.json` | Firestore + Functions |
| `.firebaserc` | Default project id |
| `apphosting.yaml` | App Hosting resource hints |
| `firestore.rules` / `firestore.indexes.json` | Rules + indexes for residual domains |

**App Hosting:** Point the backend root at this **`crm`** directory so `next.config.ts` and `package.json` are at the backend root.

## Scripts

| Script | Command |
|--------|---------|
| `npm run dev` | Next web tier (interactive) |
| `npm run worker` | BullMQ worker tier (`src/worker`) |
| `npm run build` | Production Next build (`output: 'standalone'`) |
| `npm run build:worker` | Bundle worker → `dist/worker/index.js` |
| `npm run db:migrate:deploy` | Apply Prisma migrations |
| `npm run db:studio` | Prisma Studio (Compose Postgres) |
| `npm run db:backfill:crm` / `db:reconcile:crm` | Migration soak helpers |
| `npm run db:export:firestore-crm` | Archive Firestore CRM collections |
| `npm run firebase:deploy:rules` | Deploy Firestore rules |
| `npm run firebase:deploy:functions` | Deploy Cloud Functions |

## Product / migration docs

| Doc | What |
|-----|------|
| [`Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) | Binding architecture contract |
| [`Architecture fixes plan/NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md) | Phase checklist (Week 0 → Phase 6) |
| [`Architecture fixes plan/NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md) | Clerk auth cutover |
| [`Architecture fixes plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md) | CRM Postgres sole-writer / Firebase residual |
| [`Architecture fixes plan/NOVA-CRM-P4-QUEUE-WORKER.md`](Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md) | Queue names, flags, worker soak |
| [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) | Local/staging/prod + cutover flags |
| Repo root `PROJECT-OVERVIEW.md` | Domain model / product overview |
