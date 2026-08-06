# Nova CRM — Implementation Guide: DevOps, CI/CD, Migration, Environments

Companion to `nova-crm-architecture-evaluation.md`. This covers the *how* of getting from where you are to the target architecture.

---

## 1. DevOps / Microservices / Containers / Cloud — what "best practice" actually means for you

Your screenshot names four categories. Here's what each one should concretely mean for Nova, and how to self-check against it:

### DevOps
- **Best practice:** every change goes through a pipeline (lint → test → build → deploy) automatically; nobody deploys by hand from their laptop; infrastructure is defined as code (not clicked together in a console).
- **Self-check:** if you can't answer "what commit is running in production right now, and can I redeploy last week's version in 2 minutes" — you're not there yet. Section 2 gets you there.

### Microservices
- **Decision (final, revisit only if a specific trigger below is hit):** Nova does **not** adopt classic microservices — many independently-deployed services, each with its own database, talking over the network. For your current scale and team size this would add real cost (inter-service network calls where you'd otherwise have a function call, distributed transactions instead of one DB transaction, more services to secure/monitor/deploy, higher cloud bill from many small always-on services) without solving a problem you actually have. Microservices mainly solve an *organizational* problem — many teams needing to ship independently — not a technical one, and you don't have that problem yet.
- **What Nova uses instead: exactly two deployables.**
  1. **Web tier** (Next.js, user-facing) — `Dockerfile`
  2. **Worker tier** (queue consumers: email sync, imports, scrapers, AI/RAG jobs, scheduled sends) — `Dockerfile.worker`
  This gets you the actual enterprise-scaling benefit you need — background work can never block interactive traffic, and each tier scales independently — without the microservices tax.
- **Re-litigate this decision only if:** a specific subsystem needs a release cadence or team ownership independent of the rest of the app, or needs to scale an order of magnitude beyond everything else (e.g., AI/RAG becomes its own product surface). Until then, two tiers is correct and this section is not open for per-task reinterpretation.

### Containers
- **Best practice:** your app and worker each build to a Docker image; the *same* image is deployed to staging and production (only env vars differ); images are versioned/tagged by git commit SHA, not `latest`.
- **Self-check:** if staging and production could ever be running different code because someone "made a small fix directly on the server," that's a container-discipline gap.
- **Status: implemented.** `Dockerfile` (web tier), `Dockerfile.worker` (worker tier), `docker-compose.yml` (local dev: Postgres + Redis + both tiers), and `.dockerignore` are provided alongside this guide — see §2.4 below for how they plug into CI/CD.

### Cloud
- **Best practice:** managed services over self-hosted where it doesn't cost much more (managed Postgres, managed Redis) — self-host only what genuinely needs it. Secrets live in a secrets manager, not `.env` files committed anywhere. One cloud account/project *per environment* (dev/staging/prod), not one project with environment folders inside it.
- **Self-check:** could a bug in staging ever touch production data? If yes (shared DB, shared bucket, shared project), that's the gap to close first — see §5.

---

## 2. CI/CD pipeline

### 2.1 Git branching model

Use **trunk-based development**, not GitFlow — GitFlow is heavier than a team your size needs and slows down a fast-moving product:

- `main` — always deployable, protected branch (no direct pushes, PR + passing checks required)
- `feature/*` branches — short-lived, one PR each, merged into `main` via PR
- Tags (`v1.2.0`) — cut from `main` when you want to mark a production release

### 2.2 Pipeline stages (GitHub Actions example)

```yaml
# .github/workflows/ci.yml — runs on every PR
name: CI
on: [pull_request]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

```yaml
# .github/workflows/deploy-staging.yml — runs on merge to main
name: Deploy Staging
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build & push Docker image
        run: |
          docker build -t registry/nova-crm:${{ github.sha }} .
          docker push registry/nova-crm:${{ github.sha }}
      - name: Run DB migrations against staging
        run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
      - name: Deploy to staging
        run: ./deploy.sh staging ${{ github.sha }}
```

```yaml
# .github/workflows/deploy-production.yml — runs on tag push, needs manual approval
name: Deploy Production
on:
  push:
    tags: ['v*']
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production   # GitHub "environment" = manual approval gate
    steps:
      - uses: actions/checkout@v4
      - name: Run DB migrations against production
        run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
      - name: Deploy
        run: ./deploy.sh production ${{ github.ref_name }}
```

### 2.4 How the Docker files plug into the pipeline

The `docker build` step in §2.2's staging workflow builds directly from `Dockerfile` (web) and, as a second job, `Dockerfile.worker`. Two things to set up before that step works:

1. Add `output: 'standalone'` to `next.config.js` — this is what makes the web image small and self-contained (no `node_modules` bloat in the final image).
2. Add a `build:worker` script to `package.json` that compiles your worker entrypoint (e.g. `tsc -p tsconfig.worker.json`) — `Dockerfile.worker` expects this. If the worker code doesn't exist yet, this is a Phase 3 task (see §4 of this guide); the Dockerfile is ready for when it does.

Locally, `docker compose up` gives every developer an identical Postgres + Redis + web + worker environment — this is what makes "works on my machine" differences between developers (and between local/staging/production) go away.

### 2.3 Non-negotiables in the pipeline

- **Migrations run in CI, not manually.** Use a migration tool (Prisma Migrate, Drizzle Kit, or plain `node-pg-migrate`) so schema changes are version-controlled files, applied automatically, and reversible.
- **No merge to `main` without green checks** — enforce via GitHub branch protection rules.
- **Production deploys require an explicit tag + manual approval gate.** Staging deploys can be automatic on every merge.
- **Rollback = redeploy the previous image tag.** Since images are immutable and tagged by commit SHA, rollback is a one-command operation, not a git revert-and-rebuild scramble.

---

## 3. Migrating Firestore (NoSQL) → PostgreSQL

This is a schema-design project first, a data-movement script second. Do not skip the design step.

### 3.1 Step 1 — Design the relational schema

Take your Firestore collections (`leads`, `accounts`, `contacts`, `deals`, `organizations/{orgId}/members`, etc.) and convert:

| Firestore pattern | Postgres equivalent |
|---|---|
| Top-level collection with `organizationId` field | Table with `organization_id` foreign key + RLS policy |
| Subcollection (`organizations/{orgId}/members`) | Table with `organization_id` FK (subcollections just become normal FKs) |
| Denormalized arrays (`managerAncestorIds`) | Either a proper `manager_id` self-referencing FK + recursive CTE query, or a `closure table` if you need fast ancestor queries at scale |
| `computedPermissions/{uid}` | Either compute permissions in a DB view, or keep as a table recomputed in a transaction on role change (no more "legacy Cloud Function recompute on write" — do it synchronously) |
| Vector embeddings (chunk collection, dim 1536) | `pgvector` column type, same dimension, HNSW or IVFFlat index |

Deliverable of this step: an ERD + `schema.sql` (or Prisma/Drizzle schema file) reviewed before any data moves.

### 3.2 Step 2 — Build the ETL script

A Node script using `firebase-admin` to read + `pg` (or your ORM) to write:

1. **Extract:** paginate through each Firestore collection (don't load a 100k-doc collection into memory at once — use `startAfter` cursors).
2. **Transform:** map each document to its relational shape; resolve denormalized arrays into foreign keys; validate required fields; log anything that doesn't map cleanly instead of silently dropping it.
3. **Load:** batch-insert into Postgres (batches of ~500–1000 rows) inside transactions, in dependency order (organizations → members → accounts → contacts → leads → deals → …, so foreign keys never point to a row that doesn't exist yet).

### 3.3 Step 3 — Dual-write period (don't cut over blind)

For each entity type, once the ETL has run once as a backfill:
- New writes go to **both** Firestore and Postgres for a validation window (days, not weeks).
- Run a reconciliation script that diffs row counts and spot-checks field values between the two stores.
- Only once reconciliation is clean do reads cut over to Postgres for that entity (see the phased plan in the architecture doc, §4).

### 3.4 Step 4 — Cutover and decommission

Once all entities are validated and reads are fully on Postgres, stop dual-writing, then remove the Firestore write path from the codebase. Keep a final Firestore export archived (cheap insurance) for a few months before fully decommissioning the Firebase project.

### 3.5 Practical tips

- Run the full ETL against a **staging Postgres instance first**, timed, so you know how long the real cutover will take and can schedule a low-traffic maintenance window if needed.
- Import order matters — get the dependency graph right (§3.2) or you'll spend the migration debugging FK violations instead of data quality.
- Keep the ETL script idempotent (safe to re-run) — you will re-run it more than once.

---

## 4. Do it all at once, or step by step?

**Step by step. Not all at once.** This is worth being direct about: attempting the full stack swap (DB + auth + queue + hosting + real-time) simultaneously, especially via vibe coding, is how CRMs end up with data loss, broken auth, or weeks of downtime. Vibe coding is great for velocity within a well-scoped change; it is risky as the *only* safety net for a system-wide rewrite done in one shot, because there's no human architecture review catching cross-cutting mistakes before they ship.

**Recommended order (highest pain / lowest risk first):**

1. **Redis-cached dashboard summaries on your *current* Firebase stack** (Phase 0 from the architecture doc) — days of work, immediate visible relief, zero migration risk.
2. **Split cron/worker traffic off your interactive App Hosting instances** onto a separate Cloud Run service — reduces "hanging," still no data migration.
3. **Stand up Postgres + schema, dual-write core CRM entities** (leads, accounts, contacts, deals, organizations, members) — the biggest single piece of work, do it entity-group by entity-group, not all 60 collections at once.
4. **Cut dashboard reads over to Postgres** — this is where the "feels premium" fix actually lands for the user.
5. **Move background jobs to a real queue + worker tier.**
6. **Migrate auth** (WorkOS/Clerk/Auth.js) — do this after the data layer is stable, since auth touches every request.
7. **Decommission Firebase** once everything above is validated in production for a few weeks.

Each step should be independently shippable, independently revertable, and validated in staging before production. That's the whole point of doing it step by step — every step is small enough to vibe-code safely with a clear "done" definition, instead of one giant change with no clear rollback point.

---

## 5. Staging, production, and environment setup

### 5.1 The three environments

| Environment | Purpose | Data | Deploys |
|---|---|---|---|
| **Local / dev** | Individual development | Local Postgres (Docker) or a personal Neon branch; seed/fake data only | Manual, whenever |
| **Staging** | Pre-production validation, QA, demo to stakeholders | Realistic but **not real customer data** — either synthetic or a scrubbed/anonymized copy of production | Automatic on every merge to `main` |
| **Production** | Real customers, real data | Real | Manual-gated, on tagged releases only |

### 5.2 Hard rules for separation

- **Separate cloud projects/accounts per environment**, not separate "folders" in one project. This is the single biggest thing that prevents a staging mistake from touching production data.
- **Separate databases entirely** — staging Postgres instance, production Postgres instance, different credentials, different network access. Never point staging at prod "just to test something real quick."
- **Separate secrets** in each environment's secrets manager (GitHub Actions environments, or AWS Secrets Manager / GCP Secret Manager per project). Production secrets should not even be *visible* to whoever has staging access, if you can arrange that.
- **Separate third-party accounts where it matters** — e.g., a sandbox Instantly/AI-provider key for staging so testing never touches real send limits, real billing, or real customer inboxes.

### 5.3 Promotion flow

```
Developer branch → PR → CI checks → merge to main
                                        │
                                        ▼
                              Auto-deploy to STAGING
                                        │
                              (manual QA / smoke test)
                                        │
                                        ▼
                          Tag release (v1.4.0) → manual approval
                                        │
                                        ▼
                              Deploy to PRODUCTION
```

### 5.4 Extra environment recommendations

- **Database branching for staging/preview:** if you use Neon, its branch-per-PR feature gives each pull request its own isolated Postgres copy for testing migrations safely — genuinely useful for a fast-moving vibe-coded workflow, since a bad migration can be tested in total isolation before it ever touches shared staging.
- **Feature flags** for anything risky (new dashboard read path, new auth provider) so you can roll out to a subset of orgs in production and roll back instantly without a redeploy.
- **Smoke tests post-deploy:** a small automated check (login works, dashboard loads, a lead can be created) that runs immediately after every staging and production deploy, so a broken deploy is caught in seconds, not when a user reports it.

---

## 6. On doing this with vibe coding

Vibe coding is a legitimate way to build this — plenty of production SaaS gets built this way now — but it works best with **guardrails**, precisely because an AI assistant will happily implement whatever you ask without necessarily flagging "this violates the architecture we agreed on three sessions ago." That's exactly the gap the rules document (next file) closes: it's the thing that makes every future vibe-coding session accountable to the architecture decisions in this document, instead of drifting back toward Firestore-shaped instincts or reintroducing client-side recomputation without anyone noticing until the dashboard is slow again.

---

## 7. Cost estimate at scale

**Workload assumed:** ~50,000 new prospects/month, ~200,000–400,000 outbound emails/month (plus associated inbound sync, opens/click tracking, replies).

**Important honesty check before the numbers:** I don't have your actual Firebase billing export, so the "current Firebase" figure below is a *reasoned estimate* built from the architecture patterns in your evaluation doc (listener fan-out across ~8 route-scoped groups, 89 indexes, 5–15 minute crons, dashboard values recomputed from raw docs), not your real invoice. The new-stack figure is a bottom-up estimate from standard provider pricing and is more reliable because that pricing is fixed and public. **For a precise before/after, pull your last 1–3 months of actual Firebase/GCP billing** — I'd treat that as ground truth over my estimate below, and I'm happy to redo this comparison against your real numbers once you have them.

### 7.1 Estimated current Firebase cost at this workload

| Driver | Why it costs what it does | Est. monthly |
|---|---|---|
| Firestore document reads (listener fan-out) | ~8 listener groups × concurrent sessions × every write in an org re-firing every attached listener; dashboard/activity views re-reading raw docs instead of one cached row | $500 – $1,800 |
| Firestore document writes | Prospect/lead lifecycle writes + email send/tracking/inbound writes + denormalized timeline/activity/audit writes riding along on every action | $300 – $900 |
| Cloud Functions (compute + invocations) | 5-min IMAP sync (1 GiB), 5-min scheduled-email cron, 15-min scraper cron, import chunk processing, permission recompute triggers | $150 – $400 |
| App Hosting (1–3 instances, always-warm) | `minInstances: 1` keeps a paid instance running 24/7 regardless of traffic | $80 – $200 |
| Storage + misc (Auth, Storage, bandwidth) | Auth free under 50k MAU; Storage/bandwidth minor at this scale | $50 – $150 |
| **Estimated total** | | **~$1,100 – $3,450 / month** |

The wide range exists because Firestore's per-read billing is inherently unpredictable — it scales with *how many listeners happen to be open when a write occurs*, not with a fixed resource you provision. That unpredictability is itself part of the problem, independent of the raw dollar figure.

### 7.2 Estimated new-stack cost at the same workload

| Component | Sizing at this scale | Est. monthly |
|---|---|---|
| PostgreSQL (primary + read replica for reporting) | Managed (Neon Scale / RDS db.m6g.large-equivalent), autoscaled compute | $250 – $450 |
| Redis (cache + pub/sub + queue backing) | Managed (Upstash / ElastiCache), small-medium instance | $50 – $150 |
| Message queue | SQS-equivalent (near-free at this message volume) or bundled into Redis via BullMQ | $0 – $50 |
| Web tier compute (Cloud Run / Fargate / Fly, autoscaled) | 2–4 instances average under load | $150 – $400 |
| Worker tier compute | Continuous IMAP sync for many mailboxes + import/AI job processing | $150 – $350 |
| Object storage (S3 / R2) | Imports, exports, attachments | $10 – $30 |
| CDN (Cloudflare) | Static + edge caching | $0 – $20 |
| Auth provider (WorkOS / Clerk) | Free tier covers most MAU; SSO connections billed per-connection if/when enterprise customers need SAML | $0 – $300 |
| Observability (Grafana Cloud / Better Stack) | Logs, traces, alerting | $50 – $150 |
| **Estimated total** | | **~$660 – $1,900 / month** |

**Not included in either column, because it's unaffected by this migration:** your Instantly subscription and AI provider (OpenAI/Anthropic/Google) API usage. Those are billed by their own providers regardless of what database or hosting you run underneath — this migration doesn't move that cost either direction.

### 7.3 Estimated percentage reduction

| | Low-cost scenario | High-cost scenario |
|---|---|---|
| Firebase (current) | $1,100 | $3,450 |
| New stack | $1,900 | $660 |
| **Reduction** | **~-73% (could cost more at the low end — see note)** | **~81%** |

Read that low-cost-scenario column carefully: if your *actual* current Firebase bill happens to be near the bottom of my estimated range, the new stack's fixed baseline (managed Postgres + Redis + two compute tiers running 24/7) could plausibly cost about the same or slightly more in absolute dollars at this specific workload size. The win in that case isn't primarily "cheaper today" — it's that **the new stack's cost scales predictably with provisioned compute, not with read/listener volume**, so it doesn't blow up unpredictably as you add tenants, the way Firestore's billing model does. If your actual bill is nearer the high end of my range (which "getting very slow, hanging, and cost a lot" suggests it plausibly is), a **60–80% reduction is a realistic expectation**.

**Bottom line: share your actual last 1–3 Firebase invoices and I'll turn this from an estimate into a real, evidence-based comparison** — that's the only way to give you a number you can actually plan a budget around instead of a directional range.
