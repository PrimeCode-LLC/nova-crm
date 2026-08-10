# Phase 1 — Background jobs / crons inventory (P1.1)

**Status:** Complete (2026-08-11)  
**Purpose:** Rank every cron and heavy background job by how much it can hang or starve the **interactive App Hosting** web tier, so P1.2+ can move the worst offenders off first.  
**Rule:** ENGINEERING_RULES §3 / §5 — background work must not block the web tier; long jobs belong on a dedicated worker path (today: separate Cloud Run / Functions service; later Phase 4: real queue + `Dockerfile.worker`).

**Surfaces covered:**
- App Hosting cron routes: `src/app/api/cron/**`
- Scheduler proxies that *call* those routes: `functions/src/appHostingCron.ts`
- Import workers: `functions/src/prospectImportWorker.ts`
- Related long `maxDuration` API routes on the web tier
- Firestore-triggered Functions that already run off App Hosting (noted, not P1 move targets)

**How crons reach App Hosting today:** Cloud Scheduler Functions (`onSchedule`) `fetch` the public site with `Authorization: Bearer CRON_SECRET`. The **work runs inside App Hosting** (`maxInstances: 3`, `concurrency: 80`, 1 vCPU / 1 GiB). Schedulers themselves are thin proxies (`timeoutSeconds` up to 540) waiting on that HTTP call.

---

## Legend

| Column | Meaning |
|--------|---------|
| **Hang rank** | 1 = move first (highest risk to interactive UX) |
| **Runs on** | Where CPU/network work actually executes |
| **Cadence** | Schedule or trigger |
| **Cap** | Explicit work limits in code |
| **Budget** | Route `maxDuration` / Function `timeoutSeconds` |

**Hang-risk factors used (in order):** runs on App Hosting · wall-clock / `maxDuration` · external I/O (IMAP/SMTP/HTTP) · frequency · multi-tenant fan-out · concurrency with other heavy crons · already isolated off web.

---

## Ranked inventory (move order for P1.2+)

| Hang rank | Job | Runs on | Cadence | Cap | Budget | Why this rank |
|-----------|-----|---------|---------|-----|--------|----------------|
| **1** | Inbox IMAP head sync | **Cloud Functions** `syncInboxImapHeads` → `inboxImapSync.ts` (P1.2); AH only `/api/cron/inbox-imap/postprocess` | Every 5 min (`*/5`) | ≤12 mailboxes/tick, sequential IMAP; ≤800 heads/mailbox | CF 540s · 1 GiB; postprocess route 300s | **Moved off interactive App Hosting (P1.2).** Rollback: `IMAP_SYNC_RUNTIME=apphosting` |
| **2** | Scheduled outbound email send | **Cloud Functions** `sendDueScheduledEmails` → `scheduledEmailSend.ts` (P1.3); AH `POST /api/cron/scheduled-emails/postprocess` | Every 5 min (`2-59/5`) | ≤50 due docs/tick; **requeue** send gaps (no sleep) | CF 540s · 1 GiB; postprocess 120s | **Moved off interactive App Hosting (P1.3).** Rollback: `SCHEDULED_EMAIL_RUNTIME=apphosting` |

| **3** | Due RSS scrapers + intake cleanup | **App Hosting** `/api/cron/scrapers/run` (`runDueScrapers`) | ~Every 15 min (`7-59/15`) | Feed concurrency 4; RSS timeout 25s/feed; all orgs’ due feeds; then intake pool cleanup | Route 300s · CF 540s · 512 MiB | Multi-tenant HTTP fan-out + Firestore writes; can run long when many feeds are due |
| **4** | Manual / API scraper run | **App Hosting** `POST` paths on `/api/org/scraper-feeds` | User/admin triggered | Same `runScraperFeedsServer` path (concurrency 4) | Route 300s | Same heavy work as #3 but on-demand; competes with interactive traffic when an admin clicks Run |
| **5** | MillionVerifier bulk verify | **App Hosting** `/api/integrations/millionverifier/verify` | User triggered | External API batching | Route 300s | Long outbound HTTP on web tier; lower frequency than crons |
| **6** | Prospect import preview / confirm staging | **App Hosting** `/api/org/imports/preview`, `…/confirm` | User triggered | Parse ≤10k rows / 20 MB; stage chunks of 40 rows | Default route budget | CPU/memory spike + many Firestore writes on web; **row processing already offloaded** to CF (see #A) |
| **7** | Content capture reminders | **App Hosting** `/api/cron/content-capture-reminders` (`sendContentCaptureReminders`) | Hourly; effective ~09:00 per org TZ | Scan brands + org captures; notify idle capturers | Route 120s · CF 540s · 512 MiB | Mostly Firestore + notifications; most hourly ticks no-op outside local 09:00 |

### Already off the interactive web tier (do not treat as P1.2 move targets)

| ID | Job | Runs on | Cadence | Cap | Budget | Notes |
|----|-----|---------|---------|-----|--------|-------|
| A | `processProspectImportChunk` | **Cloud Functions** (`importJobChunks/{chunkId}` update) | On chunk `queued` | ≤40 rows/chunk; `maxInstances: 3`; `concurrency: 1`; 3 attempts | 180s · 1 GiB | Correct pattern for Phase 1 — already isolated. Later Phase 4 may move to BullMQ worker |
| B | `cleanupProspectImportTemporaryData` | **Cloud Functions** schedule | Every 60 min | ≤2 jobs/tick; batch deletes | 540s · 512 MiB | Light cleanup; stays on CF |
| C | `syncOpenSalesLeadsOnLeadWrite` / `syncOpenPipelineOnDealWrite` / followup KPI refresh | **Cloud Functions** Firestore triggers | On write | Full org `leads`+`deals`+`followups` scan per recompute | Default CF | Can be expensive for CF cost/latency cascades, but **not** App Hosting hang. Optimize in Phase 3 summary path, not P1 |
| D | `recomputePermissionsOnUserWrite` | **Cloud Functions** | On `users/{id}` write | Single-user merge | Default CF | Small; skip unless legacy path still fires often |
| E | `reconcileFollowupPlanOnFollowupWrite` | **Cloud Functions** | On followup write | Plan step scan + optional summary recompute | Default CF | Secondary to C |

---

## Per-job detail

### 1 — Inbox IMAP sync (P1.2 **done**)

| | |
|--|--|
| **Heads (heavy)** | Cloud Functions `functions/src/inboxImapSync.ts` via `syncInboxImapHeads` |
| **Postprocess (light)** | App Hosting `POST /api/cron/inbox-imap/postprocess` — bounce + lead-mail fanout from stored heads |
| **Legacy / rollback** | `GET /api/cron/inbox-imap/sync` when `IMAP_SYNC_RUNTIME=apphosting` |
| **Secrets** | Functions needs `CRON_SECRET` + `EMAIL_SECRETS_KEY_BASE64`; Google OAuth via Functions params `GOOGLE_CALENDAR_CLIENT_*` / `GOOGLE_MAIL_CLIENT_*` |
| **Work** | List active orgs → due mailboxes → sequential IMAP connect → fetch inbox head (≤800) → write heads **on CF**; then AH bounce + fanout |
| **Rollback** | Set Functions param `IMAP_SYNC_RUNTIME=apphosting` (full sync on App Hosting again) |

### 2 — Scheduled emails send (P1.3 **done**)

| | |
|--|--|
| **SMTP (heavy)** | Cloud Functions `functions/src/scheduledEmailSend.ts` via `sendDueScheduledEmails` |
| **Postprocess (light)** | App Hosting `POST /api/cron/scheduled-emails/postprocess` — lead-mail + reply-intel |
| **Legacy / rollback** | `GET /api/cron/scheduled-emails/send` when `SCHEDULED_EMAIL_RUNTIME=apphosting` |
| **Work** | Collection-group due query → claim → SMTP (gap requeue, no sleep) → scheduled + followup status on CF; AH postprocess for lead-mail |
| **Rollback** | Set Functions param `SCHEDULED_EMAIL_RUNTIME=apphosting` |

### 3 — Scrapers cron

| | |
|--|--|
| **Route** | `src/app/api/cron/scrapers/run/route.ts` |
| **Impl** | `runAllOrganizationsScrapersDueServer` + `cleanupIntakePoolServer` |
| **Trigger** | `runDueScrapers` |
| **Work** | Due feeds across orgs (concurrency 4, 25s RSS timeout) → raw items → intake cleanup |
| **Rollback** | Re-point scheduler; feeds skip until next due window |

### 4 — Manual scraper run

| | |
|--|--|
| **Route** | `src/app/api/org/scraper-feeds/route.ts` (`maxDuration = 300`) |
| **Same engine as #3** | Move with #3 or force “enqueue only” once a worker exists |

### 5 — MillionVerifier

| | |
|--|--|
| **Route** | `src/app/api/integrations/millionverifier/verify/route.ts` |
| **Note** | Lower priority than scheduled crons; still a 300s web-tier hold |

### 6 — Import staging (web) vs chunk worker (CF)

| | |
|--|--|
| **Web** | Preview/parse + confirm staging (`prospect-import-server.ts`) |
| **Worker** | `processProspectImportChunk` already on Functions |
| **P1 note** | Chunk processing is done. Remaining hang risk is large preview/confirm on App Hosting — address after IMAP/email/scrapers, or with upload size/time guards |

### 7 — Content capture reminders

| | |
|--|--|
| **Route** | `src/app/api/cron/content-capture-reminders/route.ts` |
| **Impl** | `processContentCaptureRemindersServer` |
| **Trigger** | `sendContentCaptureReminders` hourly |
| **P1 note** | Lowest cron priority; move last or fold into worker when other crons move |

---

## Suggested P1.4+ sequence

1. ~~**P1.2** — Move **IMAP sync** off App Hosting~~ **done**
2. ~~**P1.3** — Move **scheduled-email send**~~ **done**
3. **P1.4** — Move **scrapers cron** (+ stop long manual runs on web, or proxy to the same service).
4. **P1.5** — Content capture reminders + any remaining 300s user APIs (MillionVerifier / import staging) as capacity allows.
5. **Out of scope for P1** — Prospect chunk worker (already CF); dashboard summary full scans (Phase 3); real queue (Phase 4).

**Stagger reminder:** IMAP CF `:00`, scheduled send CF `:02`, scrapers AH `:07` — remaining AH jobs still share `maxInstances: 3`.

---

## Phase 1 exit (from baby-steps plan)

Interactive App Hosting is not blocked by IMAP / import / scraper / scheduled-send bursts. Import chunks + **IMAP heads (P1.2)** + **scheduled SMTP (P1.3)** already off the web tier; P1.4+ must clear scrapers (rank 3–4).
