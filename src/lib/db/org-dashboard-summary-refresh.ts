/**
 * P3.2 — recompute + upsert `org_dashboard_summaries` from Postgres CRM rows.
 *
 * Leads/deals: dual-written Postgres (`payload` + columns).
 * Followups: still Firestore until that entity migrates (transitional).
 * Org timezone: Postgres `organizations.settings.timezone` when present.
 *
 * Dirty-set + ~60s cooldown so write bursts coalesce (ENGINEERING_RULES §2).
 * Full BullMQ worker moves this off the web tier in Phase 4.
 */

import type { Deal as PrismaDeal } from "@/generated/prisma/client";
import { getRedis } from "@/lib/cache/redis";
import { computeOrgDashboardSummaryFields } from "@/lib/dashboard-summary-compute";
import {
  ORG_DASHBOARD_SUMMARY_VERSION,
  type OrgDashboardSummary,
} from "@/lib/dashboard-summary";
import { isPostgresDashboardSummaryWriterEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import {
  orgDashboardSummaryToRowData,
} from "@/lib/db/org-dashboard-summary-postgres";
import { invalidateOrgDashboardSummaryPostgresCache } from "@/lib/db/org-dashboard-summary-read";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { leadFromPostgresRow } from "@/lib/db/list-leads-postgres";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Deal, Followup } from "@/lib/types";

/** Redis SET of org ids waiting for a Postgres summary refresh. */
export const ORG_DASHBOARD_SUMMARY_DIRTY_SET_KEY = "dash:pg-summary:dirty:v1";

/** Per-org cooldown so bursts coalesce (~60s freshness). */
export const ORG_DASHBOARD_SUMMARY_COOLDOWN_SECONDS = 60;

const localCooldownUntil = new Map<string, number>();

function cooldownKey(organizationId: string): string {
  return `dash:pg-summary:cooldown:v1:${organizationId}`;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

/** Map a dual-written Postgres deal row into the workspace `Deal` type. */
export function dealFromPostgresRow(row: PrismaDeal): Deal {
  const payload = payloadRecord(row.payload);
  return {
    ...payload,
    id: row.id,
    organizationId: row.organizationId,
    leadId: row.leadId,
    accountId: row.accountId,
    contactId: row.contactId,
    name: row.name,
    stage: row.stage as Deal["stage"],
    value: row.value,
    currency: row.currency,
    probability: row.probability,
    expectedCloseDate: row.expectedCloseDate.toISOString(),
    ownerId: row.ownerId,
    wonAt: row.wonAt ? row.wonAt.toISOString() : undefined,
    lostAt: row.lostAt ? row.lostAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as Deal;
}

function timezoneFromOrgSettings(settings: unknown): string {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const tz = (settings as Record<string, unknown>).timezone;
    if (typeof tz === "string" && tz.trim()) return tz.trim();
  }
  return "UTC";
}

async function loadFollowupsFromFirestore(organizationId: string): Promise<Followup[]> {
  const db = getAdminDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTIONS.followups)
      .where("organizationId", "==", organizationId)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Followup[];
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] followups load failed",
      organizationId,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Persist a domain summary row (platform/ETL path — RLS bypass). */
export async function upsertOrgDashboardSummaryPostgres(
  summary: OrgDashboardSummary,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not set");
  }
  const data = orgDashboardSummaryToRowData(summary);
  await withRlsBypass(async (tx) => {
    await tx.orgDashboardSummary.upsert({
      where: { organizationId: data.organizationId },
      create: data,
      update: {
        version: data.version,
        updatedAt: data.updatedAt,
        openSalesLeads: data.openSalesLeads,
        idleSalesLeads: data.idleSalesLeads,
        prospects: data.prospects,
        prospectsNeedRouting: data.prospectsNeedRouting,
        prospectsReadyToPush: data.prospectsReadyToPush,
        prospectsPushed: data.prospectsPushed,
        followupsDue: data.followupsDue,
        overdueFollowups: data.overdueFollowups,
        totalReplies: data.totalReplies,
        repliesPendingReview: data.repliesPendingReview,
        openPipelineValue: data.openPipelineValue,
        openDealCount: data.openDealCount,
        leadEstimateContributors: data.leadEstimateContributors,
        pipelineByStage: data.pipelineByStage,
        channelMix: data.channelMix,
        funnelByChannel: data.funnelByChannel,
        ranges: data.ranges,
      },
    });
  });
  await invalidateOrgDashboardSummaryPostgresCache(data.organizationId);
}

/**
 * Full recount from Postgres leads/deals (+ Firestore followups) and upsert.
 * Does not require the writer flag (admin / cron / tests may call directly).
 */
export async function recomputeOrgDashboardSummaryPostgres(
  organizationId: string,
): Promise<{ ok: true; summary: OrgDashboardSummary } | { ok: false; error: string }> {
  const orgId = organizationId.trim();
  if (!orgId) return { ok: false, error: "organizationId required" };
  if (!isDatabaseConfigured()) return { ok: false, error: "DATABASE_URL is not set" };

  try {
    const { leads, deals, timeZone } = await withRlsBypass(async (tx) => {
      const [leadRows, dealRows, org] = await Promise.all([
        tx.lead.findMany({ where: { organizationId: orgId } }),
        tx.deal.findMany({ where: { organizationId: orgId } }),
        tx.organization.findUnique({
          where: { id: orgId },
          select: { settings: true },
        }),
      ]);
      return {
        leads: leadRows.map(leadFromPostgresRow),
        deals: dealRows.map(dealFromPostgresRow),
        timeZone: timezoneFromOrgSettings(org?.settings),
      };
    });

    const followups = await loadFollowupsFromFirestore(orgId);
    const fields = computeOrgDashboardSummaryFields({
      leads,
      deals,
      followups,
      timeZone,
    });
    const now = new Date().toISOString();
    const summary: OrgDashboardSummary = {
      id: orgId,
      organizationId: orgId,
      version: ORG_DASHBOARD_SUMMARY_VERSION,
      updatedAt: now,
      ...fields,
    };

    await upsertOrgDashboardSummaryPostgres(summary);
    return { ok: true, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pg-dashboard-summary] recompute failed", orgId, message);
    return { ok: false, error: message };
  }
}

/** Best-effort dual-write after Firestore summary recompute (admin repair). */
export async function mirrorOrgDashboardSummaryToPostgres(
  summary: OrgDashboardSummary,
): Promise<void> {
  if (!isPostgresDashboardSummaryWriterEnabled() || !isDatabaseConfigured()) return;
  try {
    await upsertOrgDashboardSummaryPostgres(summary);
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] mirror failed",
      summary.organizationId,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function markOrgDashboardSummaryDirty(organizationId: string): Promise<void> {
  const orgId = organizationId.trim();
  if (!orgId) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.sAdd(ORG_DASHBOARD_SUMMARY_DIRTY_SET_KEY, orgId);
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] dirty mark failed",
      orgId,
      err instanceof Error ? err.message : err,
    );
  }
}

async function clearOrgDashboardSummaryDirty(organizationId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.sRem(ORG_DASHBOARD_SUMMARY_DIRTY_SET_KEY, organizationId);
  } catch {
    /* ignore */
  }
}

/**
 * Acquire ~60s cooldown for an org. Returns false if another refresh ran recently.
 */
export async function tryAcquireOrgDashboardSummaryCooldown(
  organizationId: string,
  ttlSeconds: number = ORG_DASHBOARD_SUMMARY_COOLDOWN_SECONDS,
): Promise<boolean> {
  const orgId = organizationId.trim();
  if (!orgId) return false;
  const ttl = Math.max(1, Math.floor(ttlSeconds));

  const redis = await getRedis();
  if (redis) {
    try {
      const result = await redis.set(cooldownKey(orgId), "1", { NX: true, EX: ttl });
      return result === "OK";
    } catch (err) {
      console.error(
        "[pg-dashboard-summary] cooldown SET failed",
        orgId,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const now = Date.now();
  const until = localCooldownUntil.get(orgId) ?? 0;
  if (until > now) return false;
  localCooldownUntil.set(orgId, now + ttl * 1000);
  return true;
}

/** Refresh one org when cooldown allows; leaves dirty set if skipped. */
export async function refreshOrgDashboardSummaryPostgresIfDue(
  organizationId: string,
): Promise<"refreshed" | "skipped" | "failed"> {
  const orgId = organizationId.trim();
  if (!orgId) return "failed";
  if (!isDatabaseConfigured()) return "failed";

  const acquired = await tryAcquireOrgDashboardSummaryCooldown(orgId);
  if (!acquired) return "skipped";

  const result = await recomputeOrgDashboardSummaryPostgres(orgId);
  if (!result.ok) return "failed";
  await clearOrgDashboardSummaryDirty(orgId);
  return "refreshed";
}

/**
 * Drain dirty orgs (cron). Respects cooldown; org stays dirty until a refresh lands.
 */
export async function refreshDirtyOrgDashboardSummariesPostgres(opts?: {
  limit?: number;
}): Promise<{ refreshed: number; skipped: number; failed: number; examined: number }> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 20)));
  const empty = { refreshed: 0, skipped: 0, failed: 0, examined: 0 };
  if (!isPostgresDashboardSummaryWriterEnabled() || !isDatabaseConfigured()) {
    return empty;
  }

  const redis = await getRedis();
  if (!redis) return empty;

  let orgIds: string[] = [];
  try {
    orgIds = await redis.sMembers(ORG_DASHBOARD_SUMMARY_DIRTY_SET_KEY);
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] dirty list failed",
      err instanceof Error ? err.message : err,
    );
    return empty;
  }

  const batch = orgIds.slice(0, limit);
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;
  for (const orgId of batch) {
    const status = await refreshOrgDashboardSummaryPostgresIfDue(orgId);
    if (status === "refreshed") refreshed += 1;
    else if (status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { refreshed, skipped, failed, examined: batch.length };
}

/**
 * Mark org dirty and schedule a non-blocking refresh (Next `after()`).
 * Safe to call from CRM dual-write paths; never throws to callers.
 */
export function scheduleOrgDashboardSummaryRefresh(organizationId: string): void {
  if (!isPostgresDashboardSummaryWriterEnabled() || !isDatabaseConfigured()) return;
  const orgId = organizationId.trim();
  if (!orgId) return;

  void markOrgDashboardSummaryDirty(orgId).catch(() => {
    /* logged in mark */
  });

  const runDeferred = () => {
    void refreshOrgDashboardSummaryPostgresIfDue(orgId).catch((err) => {
      console.error(
        "[pg-dashboard-summary] deferred refresh failed",
        orgId,
        err instanceof Error ? err.message : err,
      );
    });
  };

  void import("next/server")
    .then(({ after }) => {
      try {
        after(runDeferred);
      } catch {
        runDeferred();
      }
    })
    .catch(() => {
      runDeferred();
    });
}

/** Look up organizationId for a lead/deal before delete (refresh scheduling). */
export async function lookupCrmOrganizationId(
  entity: "lead" | "deal",
  id: string,
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  return withRlsBypass(async (tx) => {
    if (entity === "lead") {
      const row = await tx.lead.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      return row?.organizationId ?? null;
    }
    const row = await tx.deal.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  });
}
