# Nova CRM — Engineering Rules

**Canonical path:** `Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md`  
**Loaded into agent context via:** `AGENTS.md` (`@` include) and `.cursor/rules/nova-crm-engineering-rules.mdc` (`alwaysApply`). Root `ENGINEERING_RULES.md` is a pointer only — edit this file.

**Purpose:** This document is the standing contract for how Nova CRM is built. Every future development session — AI-assisted ("vibe coding") or human — should treat these as binding constraints, not suggestions. If a request conflicts with a rule here, flag the conflict before implementing; don't silently implement the request or silently implement the rule instead. Say what the tension is and ask.

---

## 1. Core architecture decisions (do not relitigate per-task)

These were decided deliberately after evaluating the previous Firebase-based architecture. Do not silently reintroduce the patterns they replace.

- **Database of record is PostgreSQL.** No Firestore, no other document DB, for transactional/CRM data. `pgvector` for embeddings.
- **Multi-tenancy is enforced via Row-Level Security (RLS)**, keyed on `organization_id`, at the database layer — not only in application code. Every new table with tenant-scoped data must have an RLS policy before it ships, not "added later."
- **No client-side aggregation of business metrics.** Dashboards, KPIs, funnel counts, pipeline totals are read from precomputed summary tables / materialized views, updated by background jobs on write. If a feature needs a number the user will see on load, ask: "is this precomputed, or is the client computing it from raw rows?" If the latter, stop and fix it before shipping.
- **Real-time updates are the exception, not the default.** Only chat, notifications, and explicit collision-avoidance features (e.g. "someone else claimed this") get live push updates (Postgres LISTEN/NOTIFY → Redis pub/sub → WebSocket/SSE). Everything else is request/response with cache invalidation. Do not attach a live listener to a collection/table just because it's convenient.
- **Background work runs on a queue with dedicated workers, not cron-polling inside the web tier.** Email sync, imports, scraping, AI/RAG jobs, scheduled sends all go through the queue. The web tier must never be blocked by background job execution.
- **Web tier and worker tier are separate deployables** that scale independently, each built as a Docker image (`Dockerfile`, `Dockerfile.worker`). No microservices beyond these two tiers — see §1a.
- **Docker is mandatory for both tiers.** The same built image is deployed to staging and production; only environment variables differ. No platform-specific buildpack deploys, no "quick fix pushed directly to the server."
- **Auth is not Firebase Auth.** Use the agreed provider (WorkOS/Clerk/Auth.js) with SSO/SAML support. Session pattern: short-lived httpOnly cookie, server-verified.
- **No new Firebase dependency, of any kind, for any feature**, without an explicit, written exception. This includes "just for this one small thing."

### §1b — Firebase residual exception (Phase 6 / recorded 2026-08-14)

**CRM transactional entities** (`organizations` / `members` pending sole-writer; `accounts` / `contacts` / `leads` / `deals`; org dashboard summaries) use **PostgreSQL** as the system of record when the Phase 6 read + sole-writer flags are on. Do **not** add new Firestore collections or client listeners for those entities.

**Written exception — Firebase may remain in the repo for non-CRM domains until separately migrated:**

- Realtime / collab: workspace chat, user notifications  
- Email / mailbox / lead mail messages / reply intel / mail tracking  
- Scrapers intake raw items + feeds (promote writes CRM to Postgres when sole-writer is on)  
- Imports job metadata / chunks / identity keys  
- Content calendar, prospect drafts, extension findings  
- Scheduling / meetings / calendar connections  
- AI org subcollections, platform admin / org settings still on Admin FS  
- Clerk→Firebase **custom-token bridge** (required while any client Firestore listeners remain)  
- `firebase` / `firebase-admin` packages, rules, indexes, Cloud Functions for the above  

P6.5 exit for the migration means **CRM path decommissioned**, not “zero Firebase bytes in package.json.” Full package removal is a later program of work per domain above.

### §1a — On microservices (explicit, so this isn't re-decided per task)

Nova intentionally does **not** use classic microservices (many independently-deployed services, each with its own database). Two deployables — web and worker — is the deliberate, final decision for the current stage. Do not propose splitting out a new independent service "for scalability" or "for enterprise readiness" without an explicit trigger: a subsystem needing its own release cadence/team, or needing to scale an order of magnitude beyond the rest of the app. Absent that trigger, new functionality belongs in the web tier (user-facing) or the worker tier (background/queue-consumed), not a new service.

---

## 2. Performance rules

- Any page or component that shows a number derived from more than a handful of rows must read that number from a precomputed source (cache or summary table), not compute it live from a full table scan or full collection fetch, on every render.
- Every list/table view must be paginated or cursor-based. No "fetch entire collection into the client" patterns, ever, for anything that can grow past a few hundred rows.
- New database queries must have a supporting index before merging. If you're not sure whether one exists, check `EXPLAIN ANALYZE` — don't guess.
- Cache reads (Redis) wherever a value doesn't need to be real-time-fresh. Default assumption: a dashboard number can be up to ~60 seconds stale unless a feature explicitly requires tighter freshness — in which case, justify why in the PR description.
- No new polling loop with an interval under 60 seconds without an explicit reason (and preference for push/webhook over polling in general).

---

## 3. Security rules

- **No secrets in code, ever** — not in comments, not "temporarily," not in a `.env` file committed to git. Secrets live in the environment's secrets manager only.
- **RLS is mandatory** for every tenant-scoped table (see §1). Application-layer tenant checks are a defense-in-depth addition, not a substitute.
- **Every new API route validates input** (zod or equivalent) before touching the database — no exceptions for "internal" or "admin" routes.
- **Every new API route checks auth + permission (RBAC module/verb/scope) before performing the action**, not after.
- **Staging never touches production data.** No script, migration, or "quick test" should ever point at production credentials from a non-production context.
- **No direct database writes bypassing the ORM/query layer's tenant scoping**, except in clearly-marked admin/platform-operator code paths that have their own explicit authorization check.
- Cron/webhook endpoints require signature or bearer-token verification — no unauthenticated endpoint that triggers a side effect.

---

## 4. Scalability rules

- Design every new table and every new background job assuming **multi-tenant scale from day one** — "this will be fine because we're small right now" is not an acceptable justification for a pattern that doesn't scale (e.g., in-memory aggregation, unindexed queries, synchronous cross-tenant loops).
- Any job that processes a batch (imports, scrapers, AI runs) must be chunked with retry and backoff, and must not be able to starve other tenants' jobs in the same queue (use per-tenant rate limiting or priority lanes if one tenant's workload could dominate).
- New features for large/enterprise tenants should be built assuming they may eventually run on a dedicated schema/database (§1) — avoid hardcoding assumptions that only work in the shared-schema tier.

---

## 5. Cost rules

- Prefer managed services (managed Postgres, managed Redis, managed queue) over self-hosted unless there's a clear cost or requirement reason not to — but avoid architecture choices whose cost scales per-read/per-document/per-listener the way Firestore's did. Compute-based and storage-based pricing is the goal.
- Before adding a new scheduled job, ask whether it needs to run on a timer at all, or whether it can be event-driven (triggered by the actual event instead of polling for it). Prefer event-driven.
- Before adding a new third-party API dependency, check whether it has per-call or per-seat pricing that could scale badly with tenant count, and flag it.

---

## 6. Code & process rules

- **All schema changes go through a migration file** (Prisma Migrate / Drizzle Kit / equivalent), committed to git, applied via CI — never a manual `ALTER TABLE` run by hand against any environment.
- **No direct pushes to `main`.** All changes go through a PR with passing CI (lint, typecheck, test, build) before merge.
- **No manual deploys to production.** Production deploys happen via the pipeline, gated by a tagged release and manual approval.
- Every new feature that touches tenant data should include (or explicitly note the absence of) a test covering tenant isolation — i.e., "org A cannot read org B's data through this new endpoint."
- Prefer small, independently-shippable changes over large multi-system changes in a single PR/session — this matters more, not less, in a vibe-coded workflow, because it keeps each change reviewable.

---

## 7. When a request seems to conflict with these rules

If an instruction in a session would violate one of the rules above (e.g., "just add a quick Firestore listener for this" or "let's skip the migration file and run this against prod directly to save time"), the correct behavior is:

1. Say explicitly which rule the request conflicts with.
2. Propose the compliant alternative.
3. Only proceed with the non-compliant version if the user explicitly overrides after seeing the tradeoff — and note it as a deliberate, logged exception rather than silently deviating from the architecture.

The goal of this document is to make sure fast, AI-assisted iteration doesn't quietly erode the architecture decisions that were made deliberately to fix scale, cost, and performance problems.
