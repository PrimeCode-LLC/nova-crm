# Phase 0 — Dashboard KPI inventory (P0.1)

**Status:** Complete (2026-08-11)  
**Purpose:** List every dashboard number that aggregates raw Firestore/workspace rows on the client (or scans collections for metrics), so Phase 0 can replace them with precomputed summaries + Redis cache.  
**Rule violated today:** ENGINEERING_RULES §1 / §2 — no client-side aggregation of business metrics; numbers should come from precomputed sources (~60s freshness OK).

**Surfaces covered:**
- `src/app/(app)/dashboard/page.tsx` (classic / frontline / ops / content layouts)
- `src/app/(app)/dashboard/wall/page.tsx`
- `src/app/(app)/dashboard/reply-intelligence/page.tsx`
- `src/components/dashboard/*`
- Compute helpers: `src/lib/dashboard-*.ts`, `src/lib/email/reply-action-analytics.ts`, `src/lib/email/mailbox-utilization.ts`

**How data reaches the UI today:** Almost all sales KPIs read from `useWorkspace()` (full in-memory arrays: leads, deals, followups, plans, tasks, contacts, activityRecords, campaigns, …). Widgets then `filter` / `reduce` / `useMemo` over those arrays. Mailbox utilization and reply-intelligence analytics hit dedicated API routes that still aggregate raw rows server-side.

**Existing partial precompute (do not treat as done):**
- `activityCounters` collection exists and was historically used for funnel stages; classic dashboard now passes `[]` and derives funnels from leads/deals only (`aggregateChannelFunnelCounts(key, [], …)`).
- Campaign cards sum `campaign.stats.*` (per-doc rollups) — lighter than raw sends, still client-reduced across campaigns.
- Mailbox utilization API has a 60s client cache (`useMailboxUtilization`) but still computes from mailbox/sent/scheduled rows.

**Phase 0 summary target (P0.3):** [`NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md`](NOVA-CRM-P0-DASHBOARD-SUMMARY-SCHEMA.md) — `orgDashboardSummaries/{orgId}` + Redis `dash:summary:v1:{orgId}` (does not extend `activityCounters`).

---

## Legend

| Column | Meaning |
|--------|---------|
| **Agg** | How the number is produced |
| **Raw inputs** | Collections / arrays scanned |
| **P0 priority** | Suggested cutover order (1 = first) |
| **Kind** | `scalar` KPI tile · `series` chart · `table` scoreboard · `list` count+rows |

---

## A. Workflow / pulse KPIs (shared)

**Compute:** `computeDashboardWorkflowMetrics` in `src/lib/dashboard-workflow.ts`  
**UI:** Classic `KpiCard` row; `OpsPulseStrip`; frontline board; wall metrics; CSV export.

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|-------|
| Open sales leads | scalar | leads | count open non-prospect | **1** | Headline; easy summary field |
| Idle sales leads | scalar | leads | count `isIdle` open | **1** | Hint on open-leads card; also IdleLeads widget |
| Prospects (total) | scalar | leads | count `intakeKind === prospect` | 2 | |
| Prospects need routing | scalar | leads | filter assignments empty | 2 | |
| Prospects need sequence | scalar | leads + plans + followups | sequence status helper | 3 | Cross-collection |
| Prospects ready to push | scalar | leads | assignments not pushed | 2 | |
| Prospects pushed | scalar | leads | `linkedSalesLeadId` set | 2 | |
| Follow-ups due | scalar | followups | due-through-today filter | 2 | |
| Overdue follow-ups | scalar | followups | overdue filter | 2 | |
| Scheduled email steps | scalar | followups | deliveryStatus / scheduledEmailId | 3 | |
| Ready unscheduled steps | scalar | followups | actionable + body, no schedule | 3 | |
| Sent in range | scalar | followups | `sentAt` in range | **1** | High traffic |
| Failed deliveries | scalar | followups | failed + open | 3 | |
| Retrying deliveries | scalar | followups | needs_retry + open | 3 | |
| Opens in range | scalar | leads | `lastEmailOpenedAt` in range | 3 | |
| Bounced emails in range | scalar | contacts + tasks | max(contact bounces, bounce tasks) | 3 | |
| Open bounce review tasks | scalar | tasks | bounce-review open | 3 | |
| Active sequences | scalar | followupPlans | status active | 3 | |
| Remaining sequence steps | scalar | followups + plans | open unpaused on active plans | 3 | |
| Paused on reply | scalar | followupPlans | paused + replyMessageId | 3 | |
| Total replies | scalar | leads | lastReplyAt or stage ≥ replied | 2 | |
| Replies in range | scalar | leads | lastReplyAt in range | **1** | |
| Replies pending review | scalar | leads | pending reply review flag | 2 | |
| My open tasks | scalar | tasks | assignee = me, open | 2 | |
| Overdue tasks | scalar | tasks | mine + due &lt; now | 2 | |
| Waiting on others | scalar | tasks | created by me, assigned elsewhere | 3 | |

**Filters applied before compute (also client-side):** channel scope, owner scope, date range on leads/deals/activity (`page.tsx` memos). Summary keys must include org + optional scope dimensions, or summaries stay org-wide and filters remain a later problem.

---

## B. Pipeline / revenue KPIs

**Compute:** `computeOpenPipelineMetrics` / page reductions · `src/lib/dashboard-analytics.ts`

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|-------|
| Open pipeline value ($) | scalar | leads + deals | sum open deal values + lead estimates without open deal | **1** | Classic + frontline |
| Open deal count | scalar | deals | count non won/lost | 2 | Hint on pipeline card |
| Lead estimate contributors | scalar | leads | count open leads with estimate, no open deal | 3 | Hint only |
| Closed revenue in range ($) | scalar | deals | sum `stage === won` values | **1** | Date-filtered deals |
| Won deal count | scalar | deals | count won | 2 | |

---

## C. Response-time KPI

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|-------|
| Avg first outreach (minutes) | scalar | leads + email response context | average of per-lead first-outbound deltas | 4 | `computeAverageResponseTimeMinutes` — needs timeline/email context, harder |

---

## D. Channel / pipeline distribution widgets

| Widget / KPI | Kind | Raw inputs | Agg | P0 priority | File(s) |
|--------------|------|------------|-----|-------------|---------|
| Channel funnel stage counts (per channel) | series | leads + deals | `aggregateChannelFunnelCounts` (activityCounters unused) | 2 | `funnel-chart.tsx`, `page.tsx` |
| Pipeline distribution (counts + % by stage) | series | leads | reduce by `PIPELINE_STAGES` → `pipelineByStage` summary (P0.9) | 2 | `pipeline-distribution.tsx` |
| Channel mix (count, %, win rate per channel) | series | leads | filter/count per channel | 2 | `channel-mix.tsx` |
| Idle leads list + count | list | leads | filter `isIdle`, sort by idleDays | 2 | `idle-leads.tsx` |
| Activity trend (replies / meetings / closed / new leads by day) | series | activityRecords + deals + leads | `buildActivityTrendSeries` | 4 | `trend-chart.tsx`, analytics |

---

## E. Owner ops board (aggregations)

**UI:** `owner-ops-board.tsx` (+ wall reuse)  
**Compute:** `dashboard-ops-analytics.ts`, `dashboard-team-command.ts`, `dashboard-strategy-scoreboard.ts`

| Widget / KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|--------------|------|------------|-----|-------------|---------|
| Ops pulse strip | scalar set | workflow metrics | display only | (A) | Same as §A |
| Email volume chart (+ totals sent/opens/replies/bounces) | series | followups + leads + contacts/tasks/timeline | `buildEmailVolumeSeries` + `emailVolumeTotals` | 3 | Period buckets today/week/month |
| Follow-up schedule by day | series | followups | `buildFollowupScheduleByDay` | 3 | Month calendar counts |
| Person / ops scorecard rows | table | leads + deals + followups + tasks | `buildOpsScorecardRows` | 4 | Per-user multi-metric |
| Inbox performance rows | table | followups (+ users) | `buildInboxPerformanceRows` | 4 | sent/replies/rates/failed |
| Team Command rows + lens scores | table | leads + deals + followups + tasks + users | `buildTeamCommandRows` | 5 | **P0.13:** Redis `dash:ops-scoreboards:v1` via API (not orgDashboardSummaries) |
| Strategy scoreboard rows | table | strategies + leads + deals + followups | `buildStrategyScoreboardRows` | 5 | **P0.13:** same ops-scoreboards payload |
| Action board bucket counts | list | tasks + followups + meetings | length of buckets | 4 | Urgent/overdue/pending/meetings |
| Ops activity feed | list | timeline + org events + tasks | merge/sort recent | 5 | Not a KPI tile; still scans |
| Meetings today (pulse) | scalar | meetings API/hook | count today | 4 | `useDashboardMeetings` |

---

## F. Mailbox utilization

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|---------|
| Mailbox count / needs attention / well utilized / unassigned | scalar | mailbox rows | `summarizeMailboxUtilization` | 3 | API `/api/email/mailboxes/utilization` |
| Sent today / pending today / capacity today | scalar | same | sum across mailboxes | 3 | Client re-summarizes visible rows |

---

## G. Outreach campaigns (classic layout)

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|---------|
| Active campaigns | scalar | campaigns | count status active | 4 | Uses embedded `stats` |
| Campaign sent / replied / completed totals | scalar | campaigns | sum `stats.*` | 4 | Prefer keeping writer-side stats; only cache the reduce |

---

## H. Content ops board

**UI:** `content-ops-board.tsx`, `content-wall-board.tsx`, `my-content-plate.tsx`  
**Data:** `useContentCalendarData` (brands, items, captures)

| KPI | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----|------|------------|-----|-------------|---------|
| On my plate (open checklist steps) | scalar | content items | scan checklist assignees | 5 | Content path; lower sales urgency |
| Scheduled this week | scalar | content items | count by publishAt + status | 5 | |
| Published this week | scalar | content items | count completedAt in week | 5 | |
| Active brands | scalar | brands | count active | 5 | |
| Recent captures (7d) | scalar | captures | count by createdAt | 5 | |
| Wall board section counts | list | content board buckets | `.length` | 5 | |

---

## I. Reply intelligence dashboard

**Route:** `/dashboard/reply-intelligence`  
**API:** `GET /api/email/reply-actions/analytics` → loads reply-action rows + lead joins → `aggregateReplyIntelligence`

| KPI / breakdown | Kind | Raw inputs | Agg | P0 priority | Notes |
|-----------------|------|------------|-----|-------------|---------|
| Total / pending / sent / accepted / dismissed | scalar | replyActions (+ leads) | count by status | 5 | Already server-side scan |
| Draft ready / failed / pending | scalar | same | draft status counts | 5 | |
| Avg potential score | scalar | same | average | 5 | |
| By classification / status / recommended action | series | same | group counts | 5 | |
| Class outcomes / by owner tables | table | same + lead stage | group + win rates | 5 | |
| Actions-per-day chart | series | same | daily buckets | 5 | |

---

## J. Needs-attention / pending overview (counts only)

| Widget | Kind | Raw inputs | Agg | P0 priority | Notes |
|--------|------|------------|-----|-------------|---------|
| Needs attention item count | list | derived attention rows | sort + length | 4 | Display list; count is secondary |
| Pending followups/tasks overview counts | scalar | followups + tasks | filter lengths | 4 | `dashboard-pending-overview.tsx` |
| Pending reply reviews badge | scalar | leads | pending review filter | 2 | Overlaps §A |

---

## Suggested Phase 0 cutover order (maps to baby steps)

| Baby step | First target(s) from this inventory |
|-----------|-------------------------------------|
| **P0.3** schema | Org summary doc fields covering §A headline + §B pipeline (open leads, idle, replies in range, sent in range, pipeline $, closed $) |
| **P0.4** writer | Maintain **one** field end-to-end (recommend: `openSalesLeads` or `sentInRange`) |
| **P0.6** first read path | Wire **Open sales leads** (or Sent in range) to summary/cache |
| **P0.7+** | Remaining §A → §B → channel mix / pipeline dist / idle → funnels → email volume → mailbox util → scoreboards → reply intelligence → content |

---

## Explicit non-goals for Phase 0

- ~~Do not migrate Team Command / Strategy Scoreboard composite scores until scalar KPIs are cached~~ — done in **P0.13** (on-demand Redis, not CF orgDashboardSummaries).
- Do not reintroduce live Firestore listeners for dashboard numbers (ENGINEERING_RULES: realtime is exception-only).
- Filter dimensions (channel / owner / range): prefer org-wide precompute first; scoped variants are a follow-up design (extra Redis keys or accept client filter on small summary payloads — never re-scan full collections).

---

## Source map (quick reference)

| Helper | Path |
|--------|------|
| Workflow metrics | `src/lib/dashboard-workflow.ts` |
| Pipeline + funnel + trend | `src/lib/dashboard-analytics.ts` |
| Email volume / schedule / scorecards / feed / action board | `src/lib/dashboard-ops-analytics.ts` |
| Team Command | `src/lib/dashboard-team-command.ts` |
| Strategy scoreboard | `src/lib/dashboard-strategy-scoreboard.ts` |
| Reply intelligence | `src/lib/email/reply-action-analytics.ts` |
| Mailbox utilization | `src/lib/email/mailbox-utilization.ts` |
| Main page assembly | `src/app/(app)/dashboard/page.tsx` |
