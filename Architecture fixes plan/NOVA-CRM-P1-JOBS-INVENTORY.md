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

| **3** | Due RSS scrapers + intake cleanup | **Cloud Functions** `runDueScrapers` → `scrapersRun.ts` (P1.4); AH `/api/cron/scrapers/run` rollback only | ~Every 15 min (`7-59/15`) | Feed concurrency 4; RSS timeout 25s/feed; all orgs’ due feeds; then intake pool cleanup | CF 540s · 1 GiB | **Moved off interactive App Hosting (P1.4).** Rollback: `SCRAPERS_RUNTIME=apphosting` |
| **4** | Manual / API scraper run | **CF** `runOrgScrapers` HTTPS when `SCRAPERS_WORKER_URL` set; else AH fallback | User/admin triggered | Same engine (concurrency 4) | CF 540s · 1 GiB; AH route 300s | AH auth + proxy; long work off web when worker URL configured |
| **5** | MillionVerifier bulk verify | **CF** `verifyMillionVerifierLeads` when `MILLIONVERIFIER_WORKER_URL` set; else AH | User triggered | ≤50 leads, concurrency 5 | CF 540s · 512 MiB; AH route 300s | **P1.5:** AH auth + proxy. Rollback: `MILLIONVERIFIER_RUNTIME=apphosting` |
| **6** | Prospect import preview / confirm staging | **App Hosting** preview/confirm; **CF** chunk apply | User triggered | Parse ≤10k rows / 20 MB; stage chunks of 40 | Preview `maxDuration` 300; confirm 60; CF chunk 180s | **P1.5:** explicit route budgets; row apply already on CF |
| **7** | Content capture reminders | **Cloud Functions** `sendContentCaptureReminders` → `contentCaptureReminders.ts` (P1.5) | Hourly; effective ~09:00 per org TZ | Scan brands + org captures; notify idle capturers | CF 540s · 512 MiB | **Moved off interactive App Hosting (P1.5).** Rollback: `CONTENT_CAPTURE_REMINDERS_RUNTIME=apphosting` |

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
| **Postprocess (light)** | App Hosting `POST /api/cron/scheduled-emails/postprocess` — lead-mail + `email_sent` timeline + reply-intel |
| **Legacy / rollback** | `GET /api/cron/scheduled-emails/send` when `SCHEDULED_EMAIL_RUNTIME=apphosting` |
| **Work** | Collection-group due query → claim → SMTP (gap requeue, no sleep) + open/click tracking + custom-SMTP Sent APPEND → scheduled + followup status on CF; AH postprocess for CRM side effects |
| **Parity** | Tracking (`mailTracking.ts`), IMAP Sent APPEND (non-Gmail/Outlook), timeline `email_sent` on postprocess |
| **Rollback** | Set Functions param `SCHEDULED_EMAIL_RUNTIME=apphosting` |

### 3 — Scrapers cron (P1.4 **done**)

| | |
|--|--|
| **Heavy** | Cloud Functions `functions/src/scrapersRun.ts` via `runDueScrapers` |
| **Manual** | HTTPS `runOrgScrapers` (Bearer `CRON_SECRET`); AH proxies when `SCRAPERS_WORKER_URL` is set |
| **Legacy / rollback** | `GET /api/cron/scrapers/run` when `SCRAPERS_RUNTIME=apphosting` |
| **Work** | Due feeds across orgs (concurrency 4, 25s RSS timeout) → raw items → org activity → intake cleanup |
| **Rollback** | Set Functions param `SCRAPERS_RUNTIME=apphosting` |

### 4 — Manual scraper run

| | |
|--|--|
| **Route** | `src/app/api/org/scraper-feeds/route.ts` (`maxDuration = 300`) — auth + proxy |
| **Worker** | Same CF engine as #3 via `runOrgScrapers` |

### 5 — MillionVerifier (P1.5 **done**)

| | |
|--|--|
| **Route** | AH `POST /api/integrations/millionverifier/verify` — session auth + proxy |
| **Worker** | CF HTTPS `verifyMillionVerifierLeads` |
| **Rollback** | `MILLIONVERIFIER_RUNTIME=apphosting` (or unset worker URL) |

### 6 — Import staging (web) vs chunk worker (CF)

| | |
|--|--|
| **Web** | Preview/parse + confirm staging (`prospect-import-server.ts`); preview `maxDuration=300` |
| **Worker** | `processProspectImportChunk` already on Functions |
| **P1.5** | Explicit budgets only; full preview CF move deferred (L) |

### 7 — Content capture reminders (P1.5 **done**)

| | |
|--|--|
| **Heavy** | Cloud Functions `functions/src/contentCaptureReminders.ts` via `sendContentCaptureReminders` |
| **Legacy / rollback** | `GET /api/cron/content-capture-reminders` when `CONTENT_CAPTURE_REMINDERS_RUNTIME=apphosting` |
| **Work** | Scan brands; at org-local 09:00 notify idle/behind capturers |
| **Rollback** | Set Functions param `CONTENT_CAPTURE_REMINDERS_RUNTIME=apphosting` |

---

## Suggested next (post–Phase 1)

1. ~~**P1.2–P1.5**~~ **done** — IMAP, scheduled email, scrapers, content reminders, MillionVerifier worker, import budgets
2. **Later** — Full import preview CF move if hang reports force it; Phase 2+ from migration plan

**Stagger reminder:** IMAP CF `:00`, scheduled send CF `:02`, scrapers CF `:07`; content reminders hourly on CF.

---

## Phase 1 exit (from baby-steps plan)

Interactive App Hosting is not blocked by IMAP / import-chunk / scraper / scheduled-send / content-reminder bursts. MillionVerifier bulk verify and scraper manual runs proxy to CF when worker URLs are set.
