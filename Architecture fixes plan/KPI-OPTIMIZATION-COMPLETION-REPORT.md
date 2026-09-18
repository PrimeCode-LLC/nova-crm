# KPI Optimization — Completion Report

Date: 2026-09-18  
Branch work: uncommitted (Backend KPI Optimization follow-through)  
Verifier note: evidence pasted below; every status below is honest.

## 1. Summary table

| Phase | Status | One-line change | Evidence section |
|-------|--------|-----------------|------------------|
| 1 | **partial** | Equivalence gaps closed in pushdown; v2 jsonb indexes authored; EXPLAIN proves v1 `->>` indexes are not used by Prisma `->` filters; v2 indexes **not applied** on the connected DB (role lacks `CREATE INDEX` ownership) | §2 Phase 1, §4 EXPLAIN |
| 2 | **partial** | Redis NX + SWR (`dash:kpi:v2`); hybrid SQL aggregates behind `DASHBOARD_KPI_SQL_AGGREGATES` (default off); slim chunked CRM loads; workflow still Node; preview-scope fix preserved | §2 Phase 2, §3 Parity |
| 3 | **partial** | Ops scoreboards switched to slim chunked CRM loaders; **not** full SQL scoreboard aggregates; filtered-scope SQL still incomplete | §2 Phase 3 |
| 4 | **partial→mostly done** | Upsert (+ upsert_graph) authz closed; owner fetch fallback; inbox email→lead merge; `GET /api/org/crm-counts` + `countOnly=1`; fetch-by-id / dedupe already present | §2 Phase 4 |
| 5 | **partial** | `drain` default false; server filters (`q`, stage, channel, ownerId, …); keyset tests; **`all=1` deliberately kept** (register B not fully closed for snapshot removal) | §2 Phase 5 |
| 6 | **partial** | Writer uses SQL summary path when SQL flag on; chunked Node path remains default; Firestore comment renamed; enqueue-only when heavy queue flag on | §2 Phase 6 |

## 2. Per phase

### Phase 1 — SQL pushdown indexes + equivalence

**Acceptance:** EXPLAIN whether indexes are used; fix mismatch; close `==` coercion + range-null gaps; CI-runnable coverage.

**Done**
- `src/lib/db/document-shim/query-pushdown.ts` — numbers refused for `==`/`in` pushdown (`isPushdownEqualityValue`); range filters exclude `Prisma.JsonNull`; `!=` remains non-pushable.
- Tests: `src/lib/db/document-shim/query-pushdown.test.ts` (numeric rejection, range null exclusion).
- Additive migration: `prisma/migrations/20260918180000_pg_documents_payload_expr_indexes_v2/migration.sql` — non-partial indexes on `(payload->'field')`.
- Companion script updated: `scripts/create-pg-documents-payload-indexes-concurrently.sql`.
- EXPLAIN helper: `scripts/explain-payload-lead-id-index.ts`.

**EXPLAIN evidence (verbatim)** — connected `DATABASE_URL` host matched `dev` (not production). Role **cannot** `CREATE INDEX` (`must be owner of table pg_documents`), so v2 indexes are **not** on this DB yet.

Prisma-like `payload->'leadId'` query (what pushdown needs):

```
Limit  (cost=4.18..15.78 rows=1 width=83) (actual time=0.114..0.115 rows=0 loops=1)
  Buffers: shared hit=13
  ->  Bitmap Heap Scan on pg_documents  (cost=4.18..15.78 rows=1 width=83)
        Recheck Cond: (collection_root = 'followups'::text)
        Filter: (... AND ((payload -> 'leadId'::text) = to_jsonb('__explain_probe__'::text)))
        ->  Bitmap Index Scan on pg_documents_collection_root_idx
```

Old `payload->>'leadId'` query **does** use v1 index:

```
->  Index Scan using pg_documents_payload_lead_id_idx on pg_documents
```

Index catalog only shows v1 text/partial indexes (`pg_documents_payload_lead_id_idx`, `pg_documents_org_root_lead_id_idx`). **Conclusion:** review was correct; v2 migration is the fix; production apply needs a role that owns `pg_documents` (or the concurrent script as a privileged operator).

**Still missing**
- v2 indexes not applied on the verified DB.
- Integration suite still gated on `DOCUMENT_STORE_INTEGRATION=true` (not CI by default). Range-null unit coverage exists; live dual-run cases for absent/JSON-null not expanded in CI.

### Phase 2 — KPI engine SQL + Redis SWR

**Done**
- Redis helpers: `cacheSetNx`, `cacheGetJsonWithMeta`, `cacheSetJsonWithMeta` in `src/lib/cache/redis.ts`.
- KPI cache: `dash:kpi:v2:...` via `buildDashboardKpiCacheKey` / `DASHBOARD_KPI_CACHE_ENGINE_VERSION` in `src/lib/dashboard-kpis-server.ts`; soft TTL 60s / hard 180s; NX lock + stale-while-revalidate; in-process `inflight` retained.
- `resolveSafePreviewRole` preserved (security fix from prior review).
- Hybrid SQL module: `src/lib/dashboard-kpis-sql.ts` behind `DASHBOARD_KPI_SQL_AGGREGATES` (default **off**). Statement timeout via `setKpiAggregateStatementTimeout`.
- Slim chunked lead/deal loads for KPI inputs when using the SQL helpers.
- Dashboard production path skips workspace aggregation when V2 on: `src/app/(app)/dashboard/page.tsx` (`kpiV2 && !isDemo` → empty arrays into `computeDashboardWorkflowMetrics`).
- Guard test: `src/lib/dashboard-kpi-v2-guard.test.ts`.
- RLS smoke: `src/lib/dashboard-kpis-rls.test.ts` (org A cannot count org B leads under `withOrganizationScope`).
- Cache-key isolation unit tests in `src/lib/dashboard-kpis-server.test.ts`.

**Still missing / hybrid by design**
- Full SQL for workflow metrics (followups/plans/tasks, `sentInRange` union, bounce max, sequences) — still Node + document shim.
- `funnelByChannel`, hierarchy/`unassigned` owner scopes — Node.
- Full golden parity matrix across org/team/own × all filters × 9 ranges against live SQL — optional harness exists (`DASHBOARD_KPI_PARITY_ORG_ID`); **not run** in this session without that env.

### Phase 3 — Ops scoreboards

**Done:** `getOpsScoreboardsServer` uses slim chunked CRM loaders (same family as KPI SQL helpers).

**Not done:** email-volume / schedule / trend builders are **not** rewritten as SQL aggregates; filtered-scope SQL scoreboards incomplete. Status = **partial**.

### Phase 4 — Unblock pagination / authz

| Item | Status | Evidence |
|------|--------|----------|
| Upsert authz | **done** | `crm-write-authz.ts` upsert branch; `crm-write/route.ts` gates `upsert` + `upsert_graph` |
| Fetch-by-id A/C/D | **done** (prior) | `api/org/{accounts,contacts,deals}/[id]`; detail views |
| Server dedupe | **done** (prior + domain SQL prefilter) | `api/org/crm-dedupe` |
| Email→lead watcher | **done** (prior) | `followup-plan-reply-watcher.tsx` |
| Email→lead inbox | **done** | `inbox-workspace.tsx` merges `resolveLeadIdsByEmailClient` |
| Owner resolution | **done** | `resolveLeadOwnerIdForFirestore` → snapshot then `fetchLeadOwnerIdClient` |
| COUNT APIs | **done** | `api/org/crm-counts`; `countOnly=1` on list routes; accounts “Showing X of Y” |
| Contacts “X of Y” | **not done** | No prior UI footer call site |

### Phase 5 — Lists / pagination

**Done**
- `useCrmEntityPages` default `drain: false`; client-filter pages opt into `drain: true`.
- Server filters: `crm-list-filters.ts` + list routes (`q`, stage, channel, ownerId, intakeKind, activeOnly, archivedOnly, isIdle).
- Session-derived narrow: `crm-list-scope.ts` (members always narrowed).
- Keyset dedup tests: `crm-list-keyset.test.ts`.
- **`all=1` not disabled** — intentional; register B consumers still need workspace snapshot.

**Not done**
- Per-stage kanban pagination + server stage counts.
- Multi-column `sort` query param.
- Complex owner scopes (team / open-queue / unassigned) on list APIs.
- Disabling `all=1` behind `WORKSPACE_CRM_POLL_V2`.

### Phase 6 — Writer

**Done**
- Comment fixed: followups via document shim (`loadFollowupsFromDocuments`).
- When `DASHBOARD_KPI_SQL_AGGREGATES=true`, summary recompute can use SQL path and skip full lead/deal chunk hydrate.
- Escalation triggers remain documented as gates (not built).
- Web enqueue-only when heavy queue flag on; `after()` fallback when off.

**Not done as default:** flag off → still chunked `findMany` into Node then `computeOrgDashboardSummaryFields`.

## 3. Parity results

| Harness | Result |
|---------|--------|
| `computeScopedDashboardKpis` unit parity (fixtures) | **matches** — `dashboard-kpis-server.test.ts` |
| `resolveSafePreviewRole` escalation / narrow | **matches** — same file |
| Org-summary overlay preserves omitted fields | **matches** — same file |
| Live SQL vs client across 9 ranges × scopes | **not run** — needs `DASHBOARD_KPI_SQL_AGGREGATES=true` + `DASHBOARD_KPI_PARITY_ORG_ID` + DB |
| Accepted plan deltas (10k cap, trend caps, 60s coworker lag) | **not newly measured** this session |

Unexplained deltas: none observed in unit fixtures. Live SQL deltas: **unknown** (harness not executed against a real org).

## 4. Verification log

### `npx tsc --noEmit -p tsconfig.json`
Exit code **0** (after `Prisma.JsonNull` fix and RLS lead create shape fix).

### `npx vitest run` (final tail)

```
Test Files  1 failed | 143 passed | 3 skipped (147)
Tests       1 failed | 804 passed | 11 skipped (816)
```

Failed (pre-existing infra):
- `src/worker/hello.integration.test.ts` — `hello job timed out` (live Redis / worker).

Note: earlier in the session `scheduled-email-due-local.test.ts` also failed intermittently; final full run showed only the hello worker failure (804 passed vs baseline 785 — new tests added).

### Targeted suites (this session)
```
dashboard-kpis-server + sql + pushdown + crm-write-authz + crm-list-* + redis → 48 passed
dashboard-kpis-rls + dashboard-kpi-v2-guard → 3 passed
```

### EXPLAIN
See Phase 1 (verbatim plans). v2 indexes **absent** on DB; v1 used only for `->>` queries.

### Measurement scripts
- `scripts/explain-payload-lead-id-index.ts` — ran successfully (SELECT-only).
- Pushdown seed/measure scripts from prior agent — **not re-run** this session.

## 5. Browser verification

**Not verified.** No browser pass as director/manager/salesperson, no screenshots.

Could not verify:
- Dashboard numbers under V2 / SQL flags
- Leads paging/search under poll V2
- Kanban DnD
- Quick-add dedupe
- Inbox reply pausing sequences
- Demo dashboard

## 6. Behavior changes

| Change | Who sees it | Kind |
|--------|-------------|------|
| Flags default **off** | Nobody until enabled | safe |
| Upsert authz on existing leads with owner/archive/intakeKind | Callers of crm-write upsert | **bug fix** (security) |
| KPI V2 on: client skips workspace KPI aggregation | Dashboard users | intended |
| KPI V2 on: Redis SWR / 60s soft TTL | Dashboard users | intended; own mutations still invalidate |
| SQL aggregates flag on: pipeline/channel/closed may come from SQL | Org-wide scopes | intended; workflow still Node |
| Poll V2: drain default false + server filters | List pages when flag on | intended; incomplete kanban |
| `all=1` still polled | Everyone | **no change** (fail-safe) |
| Accepted plan deltas (10k / trend caps / 60s coworker) | Only if V2/SQL on | accepted |

## 7. Security review (this work)

| Route / surface | Validate | Authorize | Tenant | Client trust |
|-----------------|----------|-----------|--------|--------------|
| `POST /api/org/crm-write` upsert/upsert_graph | zod | `assertCrmLeadMutationAllowed` | session org | doc fields validated as record; sensitive fields gated |
| `GET /api/org/dashboard-kpis` | query parse | `guardTenantApi` + roster viewer + `resolveSafePreviewRole` | session org | previewRole **cannot widen** |
| `GET /api/org/dashboard-lists` | kind/limit | hierarchy scope | session org | previously leaky — fixed prior |
| `GET /api/org/crm-counts` | entities | `guardTenantApi` + session narrow | session org | `narrow` for admins only; members forced |
| List routes filters | query params | `guardTenantApi` + session narrow | session org | filter values trusted as filters (not identity) |
| `POST /api/org/crm-dedupe` | email/domain | `guardTenantApi` | `withOrganizationScope` | email/domain only |

## 8. Flags and rollout

| Flag | Default | On means | Breaks if | Rollback |
|------|---------|----------|-----------|----------|
| `DASHBOARD_KPI_API_V2` / `NEXT_PUBLIC_…` | off | Dashboard reads `/api/org/dashboard-kpis`; poll ≥60s when set | Set only server-side without `NEXT_PUBLIC_` → client stays legacy | unset |
| `WORKSPACE_CRM_POLL_V2` / `NEXT_PUBLIC_…` | off | 60s poll; cursor list pages; **does not** empty snapshot | Incomplete server filters + `drain:false` → short lists | unset |
| `DASHBOARD_KPI_SQL_AGGREGATES` | off | SQL overlay for pipeline/channel/closed + writer SQL path | Hierarchy scopes still Node; enable only after parity org run | unset |

## 9. Judgment calls and open questions

1. **Hybrid SQL vs full SQL:** Chose hybrid behind a new flag rather than rewriting every workflow metric in one pass. Would ask: prioritize followups SQL next, or ship V2 API without SQL flag first?
2. **v2 index apply:** Local DB role cannot create indexes. Production needs privileged `CREATE INDEX CONCURRENTLY` via companion script — confirm who runs that.
3. **`all=1` kept:** Register B still has staging/kanban/related-list dependencies on full snapshot; disabling would regress. Confirm before any poll-V2 “empty snapshot” attempt.
4. **`narrow` on list routes:** Now session-derived for members (`crm-list-scope.ts`). Admins can still pass `narrow=1`. Confirm that matches product intent for impersonation/preview.
5. **Browser verification skipped:** Need explicit go-ahead + login to staging.

## 10. Migrations

**File:** `prisma/migrations/20260918180000_pg_documents_payload_expr_indexes_v2/migration.sql`

- Additive: `CREATE INDEX IF NOT EXISTS` only; no DROP; old v1 indexes left in place.
- Prisma migrate wraps in a transaction → **cannot** use `CONCURRENTLY` here (locks possible on large tables).
- Production procedure:
  1. Run `scripts/create-pg-documents-payload-indexes-concurrently.sql` as table owner.
  2. `npx prisma migrate resolve --applied 20260918180000_pg_documents_payload_expr_indexes_v2`
  3. Or run migrate on staging first where downtime/locks are acceptable.

## Plan todo updates (recommended)

| Todo id | New status | Reason |
|---------|------------|--------|
| phase1-sql-pushdown | pending (needs apply) | Code+EXPLAIN done; indexes not applied on verified DB |
| phase2-kpi-engine | pending | Hybrid only; Redis SWR done |
| phase2-parity | completed for fixtures; live SQL pending | |
| phase3-series-ops | pending | Slim loads only |
| phase4-unblock-pagination | completed | Upsert + remaining gaps closed enough for pagination unblock |
| phase5-lists | pending | Filters/drain fixed; all=1 + kanban not done |
| phase6-writer-sql | pending | SQL path flag-gated; default still Node chunks |
