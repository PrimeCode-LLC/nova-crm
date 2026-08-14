# Nova CRM (Relay)

Next.js 16 **App Router** sales CRM. **Deploy target:** Clerk (auth) + PostgreSQL (RLS) + Redis + two Docker deployables (**web** + **worker**). No Firebase required when `FIREBASE_DISABLED` is on.

Binding rules: [`Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md). Migration checklist: [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md).

## Architecture

| Deployable | Image | Role |
|------------|--------|------|
| **Web** | `Dockerfile` | Next.js UI + API routes (interactive traffic only) |
| **Worker** | `Dockerfile.worker` | BullMQ consumer — imports, IMAP, scheduled email, scrapers, reminders, dashboard refresh |

Local infra: Compose **Postgres 16** + **Redis 7**. Default `docker compose up` starts infra only; web/worker use profile `full`.

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
```

| Concern | System of record |
|---------|------------------|
| **Auth** | **Clerk** — `/sign-in`, `/sign-up`; Nova owns tenancy (`organization_id`, roles, invites) |
| **CRM data** | **Postgres** — accounts, contacts, leads, deals, org/member lookups, dashboard summaries |
| **CRM writes** | **Sole writer** — `POST /api/org/crm-write` (no dual-write) |
| **Background jobs** | **BullMQ worker** when queue flags are on |
| **Firebase** | **Off** when `FIREBASE_DISABLED=true` — packages may remain installed but are not initialized |

## Deploy on one VPS (production)

Step-by-step Ubuntu + Docker guide (web, worker, Postgres, Redis, HTTPS, crons, backups) for non-technical and technical operators:

→ **[`docs/VPS-SINGLE-SERVER-SETUP.md`](docs/VPS-SINGLE-SERVER-SETUP.md)**

## Branching

Work on `feature/*` → PR → `main` only. See [`docs/BRANCHING.md`](docs/BRANCHING.md).

## Quick start (recommended — Firebase-free)

```bash
cd crm
npm install
cp .env.example .env.local
```

Fill `.env.local` (see below), then:

```bash
docker compose up -d postgres redis
npm run db:migrate:deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Clerk **`/sign-in`**.

### Required env (Firebase-free)

```bash
# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
AUTH_CLERK_V1=true
NEXT_PUBLIC_AUTH_CLERK_V1=true

# Kill Firebase at runtime (set both)
FIREBASE_DISABLED=true
NEXT_PUBLIC_FIREBASE_DISABLED=true

# Data
DATABASE_URL=postgres://nova_app:nova_dev_password@localhost:5432/nova_crm
MIGRATE_DATABASE_URL=postgres://nova:nova_dev_password@localhost:5432/nova_crm
REDIS_URL=redis://localhost:6379

# CRM on Postgres (reads + sole-writer + dashboard)
POSTGRES_READ_LEADS_V1=true
NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=true
POSTGRES_READ_CRM_V1=true
NEXT_PUBLIC_POSTGRES_READ_CRM_V1=true
POSTGRES_SOLE_WRITER_CRM_V1=true
NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1=true
POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true
POSTGRES_DASHBOARD_SUMMARY_READ_V1=true
NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true

# Optional
PLATFORM_ADMIN_EMAILS=you@example.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Do not set** `NEXT_PUBLIC_FIREBASE_*` / `FIREBASE_ADMIN_*` for this mode. Leave dual-write flags (`POSTGRES_DUAL_WRITE_*`) **off**.

### Prerequisites for a working login

- Orgs/members already in Postgres (from an earlier backfill, or seeded yourself).
- Clerk user email matches a Postgres `members.email` (or Clerk `externalId` = Nova `uid`).
- Platform operators: use `PLATFORM_ADMIN_EMAILS` (Firestore `platformAdmins` is unused when Firebase is off).

### Local worker

```bash
# QUEUE_WORKER_V1=true
# QUEUE_IMPORT_CHUNKS_V1=true
# QUEUE_HEAVY_JOBS_V1=true
npm run worker
```

Health: `http://127.0.0.1:8081/healthz`.

Full stack:

```bash
docker compose --profile full up --build
```

### UI-only (no Clerk)

```bash
DISABLE_AUTH=true
NEXT_PUBLIC_AUTH_DISABLED=true
```

Never use auth-disabled in production.

## What works vs what does not (Firebase off)

| Works | Unavailable until migrated off Firestore |
|-------|------------------------------------------|
| Clerk login / logout | Team chat |
| CRM lists + sole-writer mutations | User notifications (FS listeners) |
| Dashboard summaries (Postgres + Redis) | Email / mailbox / IMAP / scheduled send |
| Org members list (Postgres) | Scrapers intake / feeds UI |
| Tenant APIs with Clerk session | Content calendar, prospect drafts |
| BullMQ worker path | Firestore invite-token accept (503) |
| | Firebase password “provision login” |
| | Chrome extension FS auth bridge |

## Auth flow

1. Sign in at **`/sign-in`** or sign up at **`/sign-up`** (Clerk).
2. Server maps Clerk → Nova via `externalId` + email (`resolveClerkIdentity`) against **Postgres** members.
3. Workspace shell loads identity from **`GET /api/auth/me`** (no Firebase user doc).
4. CRM data polls Postgres APIs (no Firestore `onSnapshot`).
5. With Firebase disabled, the Clerk→Firebase custom-token bridge is **skipped**.

Details: [`NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md).

## CRM data path

| Action | Path |
|--------|------|
| List accounts / contacts / leads / deals | `GET /api/org/{accounts\|contacts\|leads\|deals}` (RLS) |
| Create / patch / delete / graph upsert | `POST /api/org/crm-write` |
| Dashboard KPIs | `GET /api/org/dashboard-summary` → Postgres + Redis |

Tenant queries: `withOrganizationScope` (`src/lib/db/tenant-scope.ts`).  
Cutover notes: [`NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md).

## Org management

- **`/admin/team`** — invites / roles / disable (`/api/org/members`, `/api/org/invites`). Invite **email send** works without Firebase; **accepting** invite tokens still needs Firestore until invites move to Postgres.
- **`/platform`** — operators via `PLATFORM_ADMIN_EMAILS`.

## Website → CRM webhook

`POST /api/integrations/webhook/lead` with `Authorization: Bearer <secret>` or `x-webhook-secret`. Body must include `organizationId`.

## Environment variables (summary)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CLERK_*` / `CLERK_SECRET_KEY` / `AUTH_CLERK_V1` | Clerk auth |
| `FIREBASE_DISABLED` / `NEXT_PUBLIC_FIREBASE_DISABLED` | Runtime kill switch |
| `DATABASE_URL` / `MIGRATE_DATABASE_URL` | Postgres app + migrate roles |
| `REDIS_URL` | Cache + BullMQ |
| `POSTGRES_READ_*` / `POSTGRES_SOLE_WRITER_*` / `POSTGRES_DASHBOARD_SUMMARY_*` | CRM cutover |
| `QUEUE_*_V1` | Route heavy jobs to worker |
| `PLATFORM_ADMIN_EMAILS` | `/platform` bootstrap |
| `CRON_SECRET` | Cron / queue dispatch bearer |

Full list: `.env.example`. Env separation: [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md).

## Scripts

| Script | Command |
|--------|---------|
| `npm run dev` | Web tier |
| `npm run worker` | BullMQ worker |
| `npm run build` | Next standalone build |
| `npm run build:worker` | Bundle worker |
| `npm run db:migrate:deploy` | Apply Prisma migrations |
| `npm run db:studio` | Prisma Studio |
| `npm run db:backfill:crm` / `db:reconcile:crm` | Migration helpers (legacy soak) |
| `npm run db:export:firestore-crm` | Archive FS CRM (only if Firebase Admin configured) |

## Optional: Firebase still enabled

Unset `FIREBASE_DISABLED` / `NEXT_PUBLIC_FIREBASE_DISABLED` and configure `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_ADMIN_*` only if you need residual Firestore domains or the Clerk→Firebase bridge. That path is transitional (ENGINEERING_RULES §1b). Prefer finishing domain migrations and keeping Firebase off for production deploys.

Legacy Cloud Functions live under `functions/` and App Hosting under `apphosting.yaml` — not required for the Firebase-free Docker/web+worker deploy.

## Docs

| Doc | What |
|-----|------|
| [`NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) | Binding contract (incl. Firebase-free override) |
| [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md) | Phase checklist |
| [`NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md) | Clerk auth |
| [`NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md) | CRM Postgres cutover |
| [`NOVA-CRM-P4-QUEUE-WORKER.md`](Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md) | Queue / worker |
| [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) | Local / staging / prod |
| [`docs/VPS-SINGLE-SERVER-SETUP.md`](docs/VPS-SINGLE-SERVER-SETUP.md) | One-VPS Ubuntu production setup (full working stack) |
