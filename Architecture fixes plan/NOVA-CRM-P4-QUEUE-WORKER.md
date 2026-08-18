# Phase 4 — Real queue + worker tier (BullMQ)

**Status:** Complete (2026-08-11)  
**Rule:** ENGINEERING_RULES §3 / §5 — background work on a dedicated worker deployable; web never runs heavy jobs.  
**Backing:** BullMQ on Compose Redis 7 (`REDIS_URL`) — same Redis as Phase 0 cache (separate key namespace via BullMQ prefixes).

## Decision (P4.1)

| Option | Why |
|--------|-----|
| **BullMQ + Redis (chosen)** | Matches local Compose Redis; mature Node API; retries/backoff; fairness via limiter + Redis window |
| Postgres-backed BullMQ | Possible later; Redis already required for cache |
| Cloud Tasks / SQS only | Extra cloud coupling; worse local DX |

**Code:** `src/lib/queue/connection.ts` · `queues.ts` · `enqueue.ts` · `flags.ts` · `fairness.ts`  
**Deps:** `bullmq` + `ioredis` (BullMQ 6 default client)

## Queue names

| Queue | Step | Purpose |
|-------|------|---------|
| `nova-hello` | P4.2 | Smoke / readiness |
| `nova-import-chunks` | P4.3 | Prospect import row apply |
| `nova-imap-sync` | P4.4 | Inbox IMAP heads (+ postprocess) |
| `nova-scheduled-email` | P4.4 | Due SMTP send (+ postprocess) |
| `nova-scrapers` | P4.4 | Due / manual RSS scrapers |
| `nova-content-reminders` | P4.4 | Content-capture reminders |
| `nova-dashboard-summary` | P4.4 | Dirty org summary refresh |

## Feature flags (defaults off — CF/AH paths remain)

| Env | Meaning |
|-----|---------|
| `QUEUE_WORKER_V1=true` | Master switch |
| `QUEUE_IMPORT_CHUNKS_V1=true` | Import chunks via BullMQ (CF Firestore trigger no-ops) |
| `QUEUE_HEAVY_JOBS_V1=true` | Heavy crons enqueue via `/api/cron/queue/dispatch` |

Also set matching Functions params `QUEUE_WORKER_V1` / `QUEUE_HEAVY_JOBS_V1` so schedulers dispatch instead of running on CF.

## Worker

| | |
|--|--|
| Entrypoint | `src/worker/index.ts` |
| Build | `npm run build:worker` → `dist/worker/index.js` (esbuild; `Dockerfile.worker`) |
| Local | `REDIS_URL=… npm run worker` |
| Health | `GET :8081/healthz` (`WORKER_HEALTH_PORT`) |

## P4.3 — Import chunks

1. `confirmProspectImportJob` sets chunks `queued` then enqueues one BullMQ job per chunk (when flags on).
2. Worker calls `processProspectImportChunkById` (`src/lib/imports/prospect-import-chunk-apply.ts`).
3. CF `processProspectImportChunk` returns early when flags on.

## P4.4 — Heavy jobs

Schedulers (CF) and AH cron routes call enqueue helpers / `POST /api/cron/queue/dispatch` when `QUEUE_HEAVY_JOBS_V1` is on. Worker processors prefer `src/lib/*` entrypoints (same as AH rollback paths).

AI/RAG remains request/response today — no background AI queue yet (Dockerfile comment is forward-looking).

## P4.5 — Fairness

- Worker `limiter` on tenant-scoped queues
- Redis sliding window `queue:fair:v1:{queue}:{orgId}` (20 / 60s); over budget → `DelayedError` + `moveToDelayed`
- Priority lanes: interactive (1) · import (2) · cron (5)

## P4.6 — Compose + standalone

- `next.config.ts` → `output: 'standalone'`
- `GET /api/health` for web image HEALTHCHECK
- Compose services `web` + `worker` under profile **`full`**:  
  `docker compose --profile full up --build`  
  (default `docker compose up -d` stays postgres + redis only for fast local DX)

## Rollback

Unset queue flags → Cloud Functions / App Hosting cron paths from Phase 1 resume. Redis outage → producers return null / 503; leave flags off until Redis is healthy.
