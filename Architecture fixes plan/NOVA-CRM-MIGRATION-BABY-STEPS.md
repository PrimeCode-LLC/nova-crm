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
| P0.13+ | [ ] | Deferred: Team Command / Strategy / inbox scoreboards (heavy multi-metric tables) |

**Phase 0 exit:** Primary dashboard numbers from precomputed/cached sources; flag can roll back; Firebase read volume for dashboard drops.

---

## Later phases

Phase 1–6 steps live in the migration plan; expand checkboxes here as each phase starts.
