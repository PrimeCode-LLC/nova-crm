/**
 * Phase 2 — scoped dashboard KPI engine (server).
 *
 * Reuses pure client helpers so numbers stay parity-locked. Org-wide unfiltered
 * views prefer the precomputed `org_dashboard_summaries` row; everything else
 * loads tenant data once, scopes it, and computes aggregates (never returns rows).
 */

import {
  cacheDel,
  cacheGetJsonWithMeta,
  cacheSetJsonWithMeta,
  cacheSetNx,
  DEFAULT_CACHE_TTL_SECONDS,
} from "@/lib/cache/redis";
import { computeOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import {
  canApplyOrgWideDashboardSummary,
  resolveDashboardKpiAccessScope,
  resolveDashboardKpiViewer,
  scopeDashboardEntitiesForKpiViewer,
  type DashboardKpiAccessScope,
} from "@/lib/dashboard-kpi-scope";
import { seesAllLeadsInTenant } from "@/lib/workspace-hierarchy";
import {
  filterLeadsByDateRange,
  filterDealsByDateRange,
  isDashboardTimeRangeKey,
  type DashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import {
  applyOrgDashboardSummaryToWorkflowMetrics,
  applyPersonDashboardGaugesToWorkflowMetrics,
  summaryClosedRevenue,
} from "@/lib/dashboard-summary-apply";
import {
  computeChannelMix,
  computeFunnelByChannel,
} from "@/lib/dashboard-summary-compute";
import { computePipelineByStage } from "@/lib/dashboard-summary";
import {
  computeDashboardWorkflowMetrics,
  isSalesLead,
  type DashboardWorkflowMetrics,
} from "@/lib/dashboard-workflow";
import { getPersonDashboardTaskGaugesServer } from "@/lib/dashboard-person-summary-server";
import type { PersonDashboardTaskGauges } from "@/lib/dashboard-person-summary";
import { getOrgDashboardSummaryFromPostgres } from "@/lib/db/org-dashboard-summary-read";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { isDashboardKpiSqlAggregatesEnabled } from "@/lib/dashboard-kpi-v2-flags";
import {
  applySqlLeadDealAggregatesToKpiPayload,
  fetchKpiSlimDealsForOrg,
  fetchKpiSlimLeadsForOrg,
  fetchScopedLeadDealSqlAggregates,
} from "@/lib/dashboard-kpis-sql";
import { listDealsFromPostgres } from "@/lib/db/list-crm-postgres";
import { listLeadsFromPostgres } from "@/lib/db/list-leads-postgres";
import { COLLECTIONS } from "@/lib/documents/collections";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import {
  filterFollowupsByOwnerScope,
  filterLeadTasksByOwnerScope,
  filterLeadsByOwnerScope,
} from "@/lib/owner-scope";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import type {
  ChannelKey,
  Contact,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  Role,
  User,
} from "@/lib/types";
import { enrichLeadsIdleState } from "@/lib/lead-idle";
import { loadEmailSendEventAtsFromServer } from "@/lib/email/record-email-send-event-server";

export type DashboardKpisPayload = {
  workflow: DashboardWorkflowMetrics;
  pipeline: {
    openPipelineValue: number;
    openDealCount: number;
    leadEstimateContributors: number;
  };
  pipelineByStage: Record<string, number>;
  channelMix: Record<string, { count: number; won: number }>;
  funnelByChannel: Record<string, Record<string, number>>;
  closedRevenue: number;
  wonDealCount: number;
  person: PersonDashboardTaskGauges | null;
  meta: {
    updatedAt: string;
    source: "org-summary" | "scoped-compute" | "cache";
    range: DashboardTimeRangeKey;
    orgWide: boolean;
  };
};

export type ComputeDashboardKpisInput = {
  organizationId: string;
  viewer: User;
  /** Session uid — preview may only narrow, never expand. */
  sessionUid: string;
  channels?: string[];
  ownerScope?: string;
  range?: string;
  previewRole?: Role | null;
  /** Bypass Redis (mutation invalidation path). */
  bypassCache?: boolean;
};

/** Bump when KPI payload shape or compute semantics change (cache isolation). */
export const DASHBOARD_KPI_CACHE_ENGINE_VERSION = "v2";

const DASHBOARD_KPI_SOFT_TTL_SECONDS = DEFAULT_CACHE_TTL_SECONDS;
const DASHBOARD_KPI_HARD_TTL_SECONDS = DEFAULT_CACHE_TTL_SECONDS * 3;
const DASHBOARD_KPI_LOCK_TTL_SECONDS = 30;
const DASHBOARD_KPI_LOCK_WAIT_MS = 50;
const DASHBOARD_KPI_LOCK_WAIT_ATTEMPTS = 6;

export function buildDashboardKpiCacheKey(parts: {
  orgId: string;
  uid: string;
  previewRole: string;
  channels: string;
  ownerScope: string;
  range: string;
}): string {
  return `dash:kpi:${DASHBOARD_KPI_CACHE_ENGINE_VERSION}:${parts.orgId}:${parts.uid}:${parts.previewRole}:${parts.channels}:${parts.ownerScope}:${parts.range}`;
}

function dashboardKpiLockKey(cacheKey: string): string {
  return `${cacheKey}:lock`;
}

function dashboardKpiIndexKey(orgId: string): string {
  return `dash:kpi:${DASHBOARD_KPI_CACHE_ENGINE_VERSION}:index:${orgId}`;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadFromCacheEntry(
  entry: NonNullable<Awaited<ReturnType<typeof cacheGetJsonWithMeta<DashboardKpisPayload>>>>,
): DashboardKpisPayload {
  return {
    ...entry.value,
    meta: { ...entry.value.meta, source: "cache" },
  };
}

async function rememberDashboardKpiCacheKey(orgId: string, cacheKey: string): Promise<void> {
  try {
    const { getRedis } = await import("@/lib/cache/redis");
    const redis = await getRedis();
    if (!redis) return;
    const index = dashboardKpiIndexKey(orgId);
    await redis.sAdd(index, cacheKey);
    await redis.expire(index, DEFAULT_CACHE_TTL_SECONDS * 3);
  } catch {
    /* best-effort */
  }
}

function parseChannels(raw: string[] | undefined): ChannelKey[] {
  if (!raw?.length) return [];
  return raw
    .map((c) => c.trim())
    .filter(Boolean) as ChannelKey[];
}

const KPI_SCOPE_RANK: Record<DashboardKpiAccessScope, number> = {
  own: 0,
  team: 1,
  org: 2,
};

/**
 * "Preview as role" may only narrow. `previewRole` arrives from the client, so a
 * salesperson asking to preview as director must not gain tenant-wide KPIs.
 * Returns null when the requested preview resolves to a broader scope than the
 * session's own, which drops it everywhere downstream (viewer, scope, cache key).
 */
export function resolveSafePreviewRole(
  sessionViewer: User,
  previewRole: Role | null | undefined,
): Role | null {
  if (!previewRole || previewRole === sessionViewer.roleId) return null;
  const sessionScope = resolveDashboardKpiAccessScope(sessionViewer, null);
  const previewScope = resolveDashboardKpiAccessScope(sessionViewer, previewRole);
  if (KPI_SCOPE_RANK[previewScope] > KPI_SCOPE_RANK[sessionScope]) return null;
  return previewRole;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function recordOr<T>(value: unknown, fallback: T): T {
  return value && typeof value === "object" ? (value as T) : fallback;
}

async function loadOrgCollection<T>(
  organizationId: string,
  collection: string,
): Promise<T[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(collection)
    .where("organizationId", "==", organizationId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export async function loadDashboardKpiInputs(organizationId: string): Promise<{
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  plans: FollowupPlan[];
  leadTasks: LeadTask[];
  contacts: Contact[];
  users: User[];
  timeZone: string;
  extraSentAts: number[];
}> {
  const orgId = organizationId.trim();
  /** Chunked slim CRM rows (drops heavy payload keys) when Postgres is configured. */
  const useSlimSqlLoad = isDatabaseConfigured();
  const [leadsRaw, deals, followups, plans, leadTasks, contacts, users, timeZone, extraSentAts] =
    await Promise.all([
      isDatabaseConfigured()
        ? useSlimSqlLoad
          ? fetchKpiSlimLeadsForOrg(orgId)
          : listLeadsFromPostgres({ organizationId: orgId })
        : loadOrgCollection<Lead>(orgId, COLLECTIONS.leads),
      isDatabaseConfigured()
        ? useSlimSqlLoad
          ? fetchKpiSlimDealsForOrg(orgId)
          : listDealsFromPostgres({ organizationId: orgId })
        : loadOrgCollection<Deal>(orgId, COLLECTIONS.deals),
      loadOrgCollection<Followup>(orgId, COLLECTIONS.followups),
      loadOrgCollection<FollowupPlan>(orgId, COLLECTIONS.followupPlans),
      loadOrgCollection<LeadTask>(orgId, COLLECTIONS.leadTasks),
      isDatabaseConfigured()
        ? (await import("@/lib/db/list-crm-postgres")).listContactsFromPostgres({
            organizationId: orgId,
          })
        : loadOrgCollection<Contact>(orgId, COLLECTIONS.contacts),
      listOrgUsersServer(orgId),
      getOrgTimezoneServer(orgId),
      loadEmailSendEventAtsFromServer(orgId),
    ]);

  // Match UI idle semantics (recompute from lastActivityAt), not stale is_idle column.
  const leads = enrichLeadsIdleState(leadsRaw);

  return {
    leads,
    deals,
    followups,
    plans,
    leadTasks,
    contacts,
    users,
    timeZone,
    extraSentAts,
  };
}

/**
 * Pure scoped compute — also used by parity tests with fixture arrays.
 */
export function computeScopedDashboardKpis(input: {
  viewer: User;
  previewRole?: Role | null;
  channels: ChannelKey[];
  ownerScope: string;
  range: DashboardTimeRangeKey;
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  plans: FollowupPlan[];
  leadTasks: LeadTask[];
  contacts: Contact[];
  users: User[];
  timeZone: string;
  extraSentAts?: number[];
}): Omit<DashboardKpisPayload, "person" | "meta"> & {
  workflow: DashboardWorkflowMetrics;
} {
  const kpiViewer = resolveDashboardKpiViewer(input.viewer, input.previewRole) ?? input.viewer;
  const kpiScoped = scopeDashboardEntitiesForKpiViewer({
    viewer: kpiViewer,
    previewRole: input.previewRole,
    orgUsers: input.users,
    leads: input.leads,
    deals: input.deals,
    followups: input.followups,
    leadTasks: input.leadTasks,
  });

  const ownerDeps = {
    currentUserId: kpiViewer.id,
    users: input.users,
    getUserById: (id: string) => input.users.find((u) => u.id === id),
    getOwnerDisplayName: (id: string) =>
      input.users.find((u) => u.id === id)?.displayName,
  };

  const channelScopedLeads =
    input.channels.length > 0
      ? kpiScoped.leads.filter((l) => input.channels.includes(l.channel as ChannelKey))
      : kpiScoped.leads;

  const ownerScopedLeads = filterLeadsByOwnerScope(
    channelScopedLeads,
    input.ownerScope,
    ownerDeps,
  );

  // Date-range filter for workflow: keep open leads always (dashboard-date-range semantics).
  const scopedLeads = filterLeadsByDateRange(ownerScopedLeads, input.range, {
    timeZone: input.timeZone,
  });
  const scopedLeadIds = new Set(scopedLeads.map((l) => l.id));

  const ownerFilteredSales = filterLeadsByOwnerScope(
    channelScopedLeads.filter(isSalesLead),
    input.ownerScope,
    ownerDeps,
  );
  const ownerSalesIds = new Set(ownerFilteredSales.map((l) => l.id));

  const ownerScopedDeals =
    input.channels.length === 0 && input.ownerScope === "all-owners"
      ? kpiScoped.deals
      : kpiScoped.deals.filter((d) => ownerSalesIds.has(d.leadId));

  const scopedDeals = filterDealsByDateRange(ownerScopedDeals, input.range, {
    timeZone: input.timeZone,
  });

  const workflowFollowups = filterFollowupsByOwnerScope(
    kpiScoped.followups.filter((f) => !f.leadId || scopedLeadIds.has(f.leadId)),
    input.ownerScope,
    ownerDeps,
  );
  const workflowPlans = input.plans.filter((p) => scopedLeadIds.has(p.leadId));
  const workflowTasks = filterLeadTasksByOwnerScope(
    kpiScoped.leadTasks.filter((t) => !t.leadId || scopedLeadIds.has(t.leadId)),
    input.ownerScope,
    ownerDeps,
  );

  const workflow = computeDashboardWorkflowMetrics({
    leads: scopedLeads,
    followups: workflowFollowups,
    plans: workflowPlans,
    tasks: workflowTasks,
    contacts: input.contacts,
    currentUserId: kpiViewer.id,
    range: input.range,
    timeZone: input.timeZone,
    extraSentAts: input.extraSentAts,
  });

  const pipelineMetrics = computeOpenPipelineMetrics(
    scopedLeads.filter(isSalesLead),
    scopedDeals,
  );
  const salesLeads = scopedLeads.filter(isSalesLead);
  const wonInScope = scopedDeals.filter((d) => d.stage === "won");

  return {
    workflow,
    pipeline: {
      openPipelineValue: pipelineMetrics.total,
      openDealCount: pipelineMetrics.openDealCount,
      leadEstimateContributors: pipelineMetrics.leadEstimateContributors,
    },
    pipelineByStage: computePipelineByStage(salesLeads),
    channelMix: computeChannelMix(salesLeads),
    funnelByChannel: computeFunnelByChannel(salesLeads, scopedDeals),
    closedRevenue: wonInScope.reduce((s, d) => s + d.value, 0),
    wonDealCount: wonInScope.length,
  };
}

const inflight = new Map<string, Promise<DashboardKpisPayload>>();

export async function getDashboardKpisServer(
  input: ComputeDashboardKpisInput,
): Promise<DashboardKpisPayload> {
  const orgId = input.organizationId.trim();
  const range: DashboardTimeRangeKey = isDashboardTimeRangeKey(input.range ?? "")
    ? (input.range as DashboardTimeRangeKey)
    : "30d";
  const channels = parseChannels(input.channels);
  const ownerScope = (input.ownerScope ?? "all-owners").trim() || "all-owners";
  const previewRole = resolveSafePreviewRole(input.viewer, input.previewRole);
  const kpiViewer = resolveDashboardKpiViewer(input.viewer, previewRole) ?? input.viewer;

  const cacheKey = buildDashboardKpiCacheKey({
    orgId,
    uid: input.sessionUid,
    previewRole: previewRole ?? "",
    channels: channels.slice().sort().join(","),
    ownerScope,
    range,
  });
  const lockKey = dashboardKpiLockKey(cacheKey);

  const computeAndCache = async (): Promise<DashboardKpisPayload> => {
    const orgWide = canApplyOrgWideDashboardSummary({
      viewer: kpiViewer,
      previewRole,
      channelScopeEmpty: channels.length === 0,
      ownerScopeIsAll: ownerScope === "all-owners",
    });

    const [personResult, bundle, summaryResult] = await Promise.all([
      getPersonDashboardTaskGaugesServer(orgId, kpiViewer.id),
      loadDashboardKpiInputs(orgId),
      orgWide ? getOrgDashboardSummaryFromPostgres(orgId) : Promise.resolve(null),
    ]);
    const person = personResult?.gauges ?? null;

    let computed = computeScopedDashboardKpis({
      viewer: input.viewer,
      previewRole,
      channels,
      ownerScope,
      range,
      ...bundle,
    });

    // Hybrid SQL path: pipeline / channel / closed-won aggregates (workflow stays Node).
    if (isDashboardKpiSqlAggregatesEnabled() && isDatabaseConfigured()) {
      const canSqlScope =
        seesAllLeadsInTenant(kpiViewer) &&
        !previewRole;
      if (canSqlScope) {
        const sqlAgg = await fetchScopedLeadDealSqlAggregates({
          organizationId: orgId,
          range,
          timeZone: bundle.timeZone,
          channels,
          ownerScope,
          currentUserId: kpiViewer.id,
          users: bundle.users,
        });
        computed = applySqlLeadDealAggregatesToKpiPayload(computed, sqlAgg);
      }
    }

    // Mirror the dashboard's overlay order exactly: live compute first, then the
    // precomputed org summary only for the fields (and the four ranges) it covers.
    // Overlaying onto a zeroed shell would blank every metric the summary omits.
    const summary = orgWide ? summaryResult?.summary ?? null : null;
    const workflow = summary
      ? applyOrgDashboardSummaryToWorkflowMetrics(
          computed.workflow,
          summary,
          range,
          person,
        )
      : applyPersonDashboardGaugesToWorkflowMetrics(computed.workflow, person);
    const closed = summaryClosedRevenue(summary, range);

    const payload: DashboardKpisPayload = {
      ...computed,
      workflow,
      pipeline: summary
        ? {
            openPipelineValue: finiteOr(
              summary.openPipelineValue,
              computed.pipeline.openPipelineValue,
            ),
            openDealCount: finiteOr(
              summary.openDealCount,
              computed.pipeline.openDealCount,
            ),
            leadEstimateContributors: finiteOr(
              summary.leadEstimateContributors,
              computed.pipeline.leadEstimateContributors,
            ),
          }
        : computed.pipeline,
      pipelineByStage: summary
        ? recordOr(summary.pipelineByStage, computed.pipelineByStage)
        : computed.pipelineByStage,
      channelMix: summary
        ? recordOr(summary.channelMix, computed.channelMix)
        : computed.channelMix,
      funnelByChannel: summary
        ? recordOr(summary.funnelByChannel, computed.funnelByChannel)
        : computed.funnelByChannel,
      closedRevenue: closed?.closedRevenue ?? computed.closedRevenue,
      wonDealCount: closed?.wonDealCount ?? computed.wonDealCount,
      person,
      meta: {
        updatedAt: summary?.updatedAt ?? new Date().toISOString(),
        source: summary ? "org-summary" : "scoped-compute",
        range,
        orgWide,
      },
    };
    await cacheSetJsonWithMeta(cacheKey, payload, {
      softTtlSeconds: DASHBOARD_KPI_SOFT_TTL_SECONDS,
      hardTtlSeconds: DASHBOARD_KPI_HARD_TTL_SECONDS,
    });
    await rememberDashboardKpiCacheKey(orgId, cacheKey);
    return payload;
  };

  const startRevalidateIfNeeded = (): void => {
    if (inflight.has(cacheKey)) return;
    void (async () => {
      const acquired = await cacheSetNx(lockKey, "1", DASHBOARD_KPI_LOCK_TTL_SECONDS);
      if (!acquired) return;
      const refresh = computeAndCache();
      inflight.set(cacheKey, refresh);
      try {
        await refresh;
      } catch {
        /* best-effort background refresh */
      } finally {
        inflight.delete(cacheKey);
        await cacheDel(lockKey);
      }
    })();
  };

  if (!input.bypassCache) {
    const entry = await cacheGetJsonWithMeta<DashboardKpisPayload>(cacheKey);
    if (entry?.value?.workflow && entry.value.meta) {
      const cached = payloadFromCacheEntry(entry);
      if (Date.now() < entry.softExpiresAt) {
        return cached;
      }
      startRevalidateIfNeeded();
      return cached;
    }

    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    const acquired = await cacheSetNx(lockKey, "1", DASHBOARD_KPI_LOCK_TTL_SECONDS);
    if (!acquired) {
      for (let i = 0; i < DASHBOARD_KPI_LOCK_WAIT_ATTEMPTS; i += 1) {
        await sleepMs(DASHBOARD_KPI_LOCK_WAIT_MS);
        const retry = await cacheGetJsonWithMeta<DashboardKpisPayload>(cacheKey);
        if (retry?.value?.workflow && retry.value.meta) {
          return payloadFromCacheEntry(retry);
        }
        const waiting = inflight.get(cacheKey);
        if (waiting) return waiting;
      }
    }

    const run = computeAndCache();
    inflight.set(cacheKey, run);
    try {
      return await run;
    } finally {
      inflight.delete(cacheKey);
      if (acquired) {
        await cacheDel(lockKey);
      }
    }
  }
  return computeAndCache();
}

/** Invalidate cached KPI payloads for an org (best-effort; TTL also bounds staleness). */
export async function invalidateDashboardKpisCache(organizationId: string): Promise<void> {
  const orgId = organizationId.trim();
  if (!orgId) return;
  try {
    const { getRedis, cacheDel } = await import("@/lib/cache/redis");
    const redis = await getRedis();
    if (!redis) return;
    const index = dashboardKpiIndexKey(orgId);
    const keys = await redis.sMembers(index);
    for (const key of keys) {
      await cacheDel(key);
    }
    await redis.del(index);
  } catch {
    /* best-effort */
  }
}
