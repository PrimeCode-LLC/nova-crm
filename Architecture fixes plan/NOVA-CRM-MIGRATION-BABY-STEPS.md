# Nova CRM — Migration baby steps (runbook)

Working checklist for the architecture migration. One baby step ≈ one PR. Do not start the next phase until the previous phase exit criteria are met.

Source plan: implementation guide §4 + `ENGINEERING_RULES` / `NOVA-CRM-ENGINEERING-RULES.md`.

**Locked defaults:** Prisma + Migrate · Compose Postgres 16 + Redis 7 · Phase 5 auth = Clerk (confirm at P5.0) · two deployables only (web + worker).

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
| P1.4 | [ ] | Move scrapers cron (+ long manual scraper runs) off App Hosting |
| P1.5 | [ ] | Move remaining light crons / long user APIs as needed (content reminders, MillionVerifier, import staging) |

**Phase 1 exit:** Interactive App Hosting is not blocked by IMAP / scraper / scheduled-send bursts. (Import chunks, IMAP heads, and scheduled SMTP send already run on Cloud Functions.)

---

## Later phases

Phase 2–6 steps live in the migration plan; expand checkboxes here as each phase starts.
