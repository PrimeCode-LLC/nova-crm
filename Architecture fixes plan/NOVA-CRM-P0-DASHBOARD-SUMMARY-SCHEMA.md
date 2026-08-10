# Phase 0 — Org dashboard summary schema (P0.3)

**Status:** Complete (2026-08-11)  
**Code:** [`src/lib/dashboard-summary.ts`](../src/lib/dashboard-summary.ts)  
**Inventory:** [`NOVA-CRM-P0-DASHBOARD-KPI-INVENTORY.md`](NOVA-CRM-P0-DASHBOARD-KPI-INVENTORY.md)

## Decision

Use a **new** collection `orgDashboardSummaries/{organizationId}` — do **not** extend `activityCounters`.

| Option | Why rejected / accepted |
|--------|-------------------------|
| Extend `activityCounters` | Per user × channel × day manual rollups; classic dashboard already passes `[]` into funnels. Wrong grain for org KPI tiles. |
| **`orgDashboardSummaries/{orgId}`** | One durable doc per tenant; matches Redis cache key; writer (P0.4) and read cutover (P0.6) stay simple. |

Writes are **Admin SDK / server only** (Firestore rules deny client write). Clients may **read** their own org’s summary when authenticated in-tenant.

## Document shape (v1)

- **Collection:** `orgDashboardSummaries`
- **Doc id:** `organizationId` (also stored as `id` + `organizationId` fields)
- **`version`:** `1` (`ORG_DASHBOARD_SUMMARY_VERSION`)
- **`updatedAt`:** ISO timestamp of last successful writer update

### Point-in-time gauges (org-wide)

| Field | Maps to (approx.) | P0 priority |
|-------|-------------------|-------------|
| `openSalesLeads` | workflow `openSalesLeads` | 1 |
| `idleSalesLeads` | workflow `idleSalesLeads` | 1 |
| `prospects` | workflow `prospects` | 2 |
| `prospectsNeedRouting` | workflow | 2 |
| `prospectsReadyToPush` | workflow | 2 |
| `prospectsPushed` | workflow | 2 |
| `followupsDue` | workflow | 2 |
| `overdueFollowups` | workflow | 2 |
| `totalReplies` | workflow | 2 |
| `repliesPendingReview` | workflow | 2 |
| `openPipelineValue` | `computeOpenPipelineMetrics().total` | 1 |
| `openDealCount` | open deals count | 1 |
| `leadEstimateContributors` | leads contributing estimate $ | 1 |
| `pipelineByStage` | sales-lead counts by `PipelineStage` (P0.9) | 1 |
| `channelMix` | per-channel `{ count, won }` (P0.10) | 2 |
| `funnelByChannel` | per-channel funnel stage counts (P0.10) | 2 |

### Range windows (`ranges.{today\|7d\|30d\|all}`)

Each window:

| Field | Meaning |
|-------|---------|
| `sent` | Followups sent in window |
| `replies` | Leads with `lastReplyAt` in window |
| `opens` | Leads with `lastEmailOpenedAt` in window |
| `bounced` | Bounce events in window |
| `closedRevenue` | Sum of won deal values in window |
| `wonDealCount` | Won deals in window |

Missing range keys mean “not written yet” — readers must fall back (flag off / live path).

## Redis

Key: `dash:summary:v1:{organizationId}` via `orgDashboardSummaryCacheKey()`.  
TTL: default **60s** (`DEFAULT_CACHE_TTL_SECONDS` in `src/lib/cache/redis.ts`).

## Out of scope for v1

- Channel / owner filter dimensions (inventory §A note)
- Person-scoped KPIs (`myOpenTasks`, overdue tasks for “me”)
- Team Command / Strategy Scoreboard composites
- Content-ops and reply-intelligence aggregates
- Replacing funnel / channel-mix series (later P0.7+)

## Next steps

- **P0.4** — [x] `openSalesLeads` writer: Cloud Function `syncOpenSalesLeadsOnLeadWrite` + Admin helpers in `dashboard-summary-server.ts`; admin recompute `POST /api/org/dashboard-summary/recompute`
- **P0.5** — [x] Feature flag `dashboard_summaries_v1` — `src/lib/dashboard-summary-flags.ts` (`DASHBOARD_SUMMARIES_V1` / `NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1`); default **off** = old path
- **P0.6** — [x] Open sales leads KPI ← Redis/Firestore summary when flag on + unfiltered org scope (`GET /api/org/dashboard-summary`, `useOrgDashboardSummary`)
- **P0.7** — [x] Idle sales leads on same writer/read path (`idleSalesLeadsContributionDelta` + CF + display override)
- **P0.8** — [x] Open pipeline gauges (`openPipelineValue`, `openDealCount`, `leadEstimateContributors`) via org recompute on lead/deal writes (`syncOpenPipelineOnDealWrite`)
- **P0.9** — [x] `pipelineByStage` written with pipeline recompute; Overview `PipelineDistribution` uses summary when flag + org-wide
- **P0.10** — [x] Full summary: remaining §A scalars, `channelMix`, `funnelByChannel`, `ranges.{today,7d,30d,all}`; admin `recomputeOrgDashboardSummaryServer`; followup writes refresh
- **P0.11+** — Deferred: mailbox util, ops scoreboards, reply-intelligence, content ops, person-scoped tasks

## Feature flag (P0.5)

| | |
|--|--|
| Id | `dashboard_summaries_v1` |
| Helper | `isDashboardSummariesV1Enabled()` |
| Env | `DASHBOARD_SUMMARIES_V1=true` and/or `NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1=true` |
| Default | **off** — dashboard keeps live aggregation |
| Rollback | unset / set to anything other than `"true"` |

## Writer notes (P0.4)
| Mechanism | Role |
|-----------|------|
| `functions` `syncOpenSalesLeadsOnLeadWrite` | Diff lead before/after; ±1 open/idle; recompute pipeline gauges + `pipelineByStage` when stage/intake/estimate changes |
| `functions` `syncOpenPipelineOnDealWrite` | Recompute pipeline gauges + `pipelineByStage` when deal value/stage changes |
| `applyLeadDashboardGaugesDeltaServer` | Same open/idle logic for Next Admin SDK callers / tests |
| `recomputeOpenSalesLeadsServer` / `recomputeOpenPipelineGaugesServer` | Absolute recount (backfill / drift repair); pipeline recompute includes `pipelineByStage` |

Deploy the Cloud Function for live correctness (`firebase deploy --only functions:syncOpenSalesLeadsOnLeadWrite`). Until then, run the recompute API after staging seed.