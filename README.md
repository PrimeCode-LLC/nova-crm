# Nova CRM (Relay)

Next.js 16 **App Router** sales CRM. **Deploy target:** Clerk (auth) + PostgreSQL + pgvector (RLS) + Redis + two Docker deployables (**web** + **worker**). Firebase is removed.

Binding rules: [`Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md). Historical phase checklist: [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md) (Phase 7 complete).

## Architecture

| Deployable | Image | Role |
|------------|--------|------|
| **Web** | `Dockerfile` | Next.js UI + API routes (interactive traffic only) |
| **Worker** | `Dockerfile.worker` | BullMQ consumer — imports, IMAP, scheduled email, scrapers, reminders, dashboard refresh |
| **Migrate** (prod) | `Dockerfile.migrate` | One-shot Prisma migrate before web/worker start |
| **Cron** (prod) | Alpine sidecar | Dispatches `/api/cron/queue/dispatch` with `CRON_SECRET` |

Local infra: Compose **Postgres 16 + pgvector** + **Redis 7**. Default `docker compose up` starts infra only; web/worker use profile `full`. Production adds **Caddy** (HTTPS) — see [`docs/VPS-SINGLE-SERVER-SETUP.md`](docs/VPS-SINGLE-SERVER-SETUP.md).

```mermaid
flowchart TB
  browser[Browser]
  web[Web_Next.js]
  clerk[Clerk_Auth]
  pg[(Postgres_RLS_pgvector)]
  redis[(Redis)]
  worker[Worker_BullMQ]
  cron[Cron_dispatch]

  browser --> web
  web -->|SSE| browser
  web --> clerk
  web --> pg
  web --> redis
  web -->|enqueue| redis
  redis --> worker
  worker --> pg
  cron -->|Bearer CRON_SECRET| web
```

| Concern | System of record |
|---------|------------------|
| **Auth** | **Clerk** — `/sign-in`, `/sign-up`; Nova owns tenancy (`organization_id`, roles, invites) |
| **CRM + org/members/invites** | **Postgres** (RLS) — accounts, contacts, leads, deals, members, `org_invites` |
| **Workspace + email + imports + scrapers** | **Postgres** — followups, labels, mail, prospect drafts, feeds |
| **AI / RAG** | **Postgres + pgvector** — libraries, documents, embeddings |
| **Dashboard KPIs** | **Postgres** `org_dashboard_summaries` + Redis cache |
| **CRM writes** | **Sole writer** — `POST /api/org/crm-write` |
| **Background jobs** | **BullMQ worker** (default on when `REDIS_URL` is set) |
| **Realtime** | Chat + notifications via Redis pub/sub + SSE (`/api/realtime/stream`) |

## Deploy on one VPS (production)

Step-by-step Ubuntu + Docker guide (web, worker, Postgres, Redis, HTTPS, crons, backups):

→ **[`docs/VPS-SINGLE-SERVER-SETUP.md`](docs/VPS-SINGLE-SERVER-SETUP.md)**

Production Compose: `docker compose -f docker-compose.prod.yml up -d` (first: `docker compose -f docker-compose.prod.yml run --rm migrate`). Backups: `scripts/backup-postgres.sh`.

## Branching

Work on `feature/*` → PR → `main` only. See [`docs/BRANCHING.md`](docs/BRANCHING.md).

## Quick start

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

### Required env

```bash
# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Data
DATABASE_URL=postgres://nova_app:nova_dev_password@localhost:5432/nova_crm
MIGRATE_DATABASE_URL=postgres://nova:nova_dev_password@localhost:5432/nova_crm
REDIS_URL=redis://localhost:6379

# Optional
PLATFORM_ADMIN_EMAILS=you@example.com
NEXT_PUBLIC_SITE_URL=http://localhost:3000
CRON_SECRET=dev-cron-secret
```

Postgres + Clerk are always on. Do not add Firebase env vars.

### Prerequisites for a working login

- Orgs/members in Postgres (migrate + seed, or accept an invite).
- Clerk user email matches a Postgres `members.email` (or Clerk `externalId` = Nova `uid`).
- Platform operators: `PLATFORM_ADMIN_EMAILS`.

### Local worker

Queue flags default **on** when `REDIS_URL` is set. Override only if you need them off:

```bash
# QUEUE_WORKER_V1=true
# QUEUE_IMPORT_CHUNKS_V1=true
# QUEUE_HEAVY_JOBS_V1=true
npm run worker
```

Health: `http://127.0.0.1:8081/healthz`.

Full stack (web + worker + postgres + redis):

```bash
docker compose --profile full up --build
```

### UI-only (no Clerk)

```bash
DISABLE_AUTH=true
NEXT_PUBLIC_AUTH_DISABLED=true
```

Never use auth-disabled in production.

## Platform capabilities

All product domains run on **Clerk + Postgres + Redis + worker**. Optional third-party keys enable extra features; they are not a second database.

| Area | How it runs |
|------|-------------|
| Clerk login / logout / signup | Required |
| CRM lists + `POST /api/org/crm-write` | Postgres + RLS |
| Dashboard KPIs | Postgres summaries + Redis |
| Org members + invite send/accept | Postgres (`org_invites`) |
| Team chat + user notifications | Postgres + SSE `/api/realtime/stream` |
| Email / mailbox / IMAP / scheduled send | Postgres + worker + mailbox/SMTP secrets |
| Scrapers, prospect drafts, imports | Postgres + worker |
| Content calendar | Postgres |
| AI / RAG | Postgres + pgvector + provider keys |
| Chrome extension | Postgres sessions / findings (Clerk for web login) |

## Auth flow

1. Sign in at **`/sign-in`** or sign up at **`/sign-up`** (Clerk).
2. Server maps Clerk → Nova via `externalId` + email (`resolveClerkIdentity`) against **Postgres** members.
3. Workspace shell loads identity from **`GET /api/auth/me`**.
4. CRM and workspace data use Postgres APIs (poll / request-response).
5. Chat and notifications subscribe via **SSE** (`GET /api/realtime/stream`). Auth is Clerk-only.

Details: [`NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md).

## CRM data path

| Action | Path |
|--------|------|
| List accounts / contacts / leads / deals | `GET /api/org/{accounts\|contacts\|leads\|deals}` (RLS) |
| Create / patch / delete / graph upsert | `POST /api/org/crm-write` |
| Dashboard KPIs | `GET /api/org/dashboard-summary` → Postgres + Redis |

Tenant queries: `withOrganizationScope` (`src/lib/db/tenant-scope.ts`).

## Org management

- **`/admin/team`** — invites / roles / disable (`/api/org/members`, `/api/org/invites`). Invites live in Postgres (`org_invites`).
- **`/platform`** — operators via `PLATFORM_ADMIN_EMAILS`.

## Website → CRM webhook

`POST /api/integrations/webhook/lead` with `Authorization: Bearer <secret>` or `x-webhook-secret`. Body must include `organizationId`.

## Environment variables (summary)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CLERK_*` / `CLERK_SECRET_KEY` | Clerk auth |
| `DATABASE_URL` / `MIGRATE_DATABASE_URL` | Postgres app + migrate roles |
| `REDIS_URL` | Cache + BullMQ |
| `QUEUE_*_V1` | Optional queue overrides (default on when Redis is set) |
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
| `npm run db:backfill:*` / `db:reconcile:*` | One-time ETL helpers (legacy soak, not daily ops) |
| `npm run check:firebase-imports` | CI regression gate — Firebase packages/imports must stay gone |

## Docs

| Doc | What |
|-----|------|
| [`NOVA-CRM-ENGINEERING-RULES.md`](Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) | Binding contract |
| [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](Architecture%20fixes%20plan/NOVA-CRM-MIGRATION-BABY-STEPS.md) | Historical phase checklist (Phase 7 = Firebase removal complete) |
| [`NOVA-CRM-P5-AUTH-CLERK.md`](Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md) | Clerk auth |
| [`NOVA-CRM-P6-DECOMMISSION-FIREBASE.md`](Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md) | Historical CRM Postgres cutover (superseded by Phase 7) |
| [`NOVA-CRM-P4-QUEUE-WORKER.md`](Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md) | Queue / worker |
| [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) | Local / staging / prod |
| [`docs/VPS-SINGLE-SERVER-SETUP.md`](docs/VPS-SINGLE-SERVER-SETUP.md) | One-VPS Ubuntu production setup |
