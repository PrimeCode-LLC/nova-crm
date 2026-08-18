/**
 * Admin SDK writer/reader for `orgDashboardSummaries` (Phase 0 / P0.4–P0.6).
 * P3.4: Postgres is the system of record for these KPIs. Firestore writes are
 * opt-in via `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1` (rollback only).
 * Clients cannot write this collection (Firestore rules deny create/update/delete).
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  ORG_DASHBOARD_SUMMARY_VERSION,
  emptyOrgDashboardSummary,
  idleSalesLeadsContributionDelta,
  leadCountsTowardIdleSalesLeads,
  leadCountsTowardOpenSalesLeads,
  orgDashboardSummaryCacheKey,
  orgDashboardSummaryDocId,
  parseOrgDashboardSummary,
  type OpenSalesLeadFields,
  type OrgDashboardSummary,
  openSalesLeadsContributionDelta,
} from "@/lib/dashboard-summary";
import { computeOrgDashboardSummaryFields } from "@/lib/dashboard-summary-compute";
import { isFirestoreOrgDashboardSummaryWriterEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import type { Deal, Followup, Lead } from "@/lib/types";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheDel,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";

function summaryRef(organizationId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.orgDashboardSummaries)
    .doc(orgDashboardSummaryDocId(organizationId));
}

async function invalidateSummaryCache(organizationId: string): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    await cacheDel(orgDashboardSummaryCacheKey(organizationId));
  } catch (err) {
    console.error("[dashboard-summary] redis invalidate failed", organizationId, err);
  }
}

/**
 * Read path (P0.6): Redis → Firestore. Warms Redis on Firestore hit.
 * Returns null when missing / invalid / Admin unavailable.
 */
export async function getOrgDashboardSummaryServer(
  organizationId: string,
): Promise<{ summary: OrgDashboardSummary; source: "redis" | "firestore" } | null> {
  const orgId = organizationId.trim();
  if (!orgId) return null;

  const cacheKey = orgDashboardSummaryCacheKey(orgId);
  if (isRedisConfigured()) {
    const cached = await cacheGetJson<OrgDashboardSummary>(cacheKey);
    const parsed = parseOrgDashboardSummary(cached);
    if (parsed) return { summary: parsed, source: "redis" };
  }

  const ref = summaryRef(orgId);
  if (!ref) return null;
  try {
    const snap = await ref.get();
    if (!snap.exists) return null;
    const parsed = parseOrgDashboardSummary(snap.data());
    if (!parsed) return null;
    if (isRedisConfigured()) {
      await cacheSetJson(cacheKey, parsed, DEFAULT_CACHE_TTL_SECONDS);
    }
    return { summary: parsed, source: "firestore" };
  } catch (err) {
    console.error("[dashboard-summary] read failed", orgId, err);
    return null;
  }
}

export type LeadDashboardGaugeDeltas = {
  openSalesLeads?: number;
  idleSalesLeads?: number;
};

/**
 * Apply ±N to lead gauges on Firestore (rollback path only).
 * P3.4: when Firestore writer is off, schedules a Postgres refresh instead.
 */
export async function applyLeadDashboardGaugesDeltaServer(
  organizationId: string,
  deltas: LeadDashboardGaugeDeltas,
): Promise<
  | { ok: true; openSalesLeads: number; idleSalesLeads: number }
  | { ok: false; error: string }
> {
  const orgId = organizationId.trim();
  if (!orgId) return { ok: false, error: "organizationId required" };
  const openDelta = deltas.openSalesLeads ?? 0;
  const idleDelta = deltas.idleSalesLeads ?? 0;
  if (!openDelta && !idleDelta) {
    return { ok: true, openSalesLeads: -1, idleSalesLeads: -1 };
  }

  if (!isFirestoreOrgDashboardSummaryWriterEnabled()) {
    if (isDatabaseConfigured()) {
      const { scheduleOrgDashboardSummaryRefresh } = await import(
        "@/lib/db/org-dashboard-summary-refresh"
      );
      scheduleOrgDashboardSummaryRefresh(orgId);
    }
    return { ok: true, openSalesLeads: -1, idleSalesLeads: -1 };
  }

  const db = getAdminDb();
  const ref = summaryRef(orgId);
  if (!db || !ref) return { ok: false, error: "Admin Firestore unavailable" };

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = new Date().toISOString();
    if (!snap.exists) {
      const seeded = emptyOrgDashboardSummary(orgId, now);
      seeded.openSalesLeads = Math.max(0, openDelta);
      seeded.idleSalesLeads = Math.max(0, idleDelta);
      tx.set(ref, seeded);
      return {
        openSalesLeads: seeded.openSalesLeads,
        idleSalesLeads: seeded.idleSalesLeads,
      };
    }
    const data = snap.data() ?? {};
    const openSalesLeads = Math.max(0, Number(data.openSalesLeads ?? 0) + openDelta);
    const idleSalesLeads = Math.max(0, Number(data.idleSalesLeads ?? 0) + idleDelta);
    tx.set(
      ref,
      {
        id: orgId,
        organizationId: orgId,
        version: ORG_DASHBOARD_SUMMARY_VERSION,
        openSalesLeads,
        idleSalesLeads,
        updatedAt: now,
      },
      { merge: true },
    );
    return { openSalesLeads, idleSalesLeads };
  });

  await invalidateSummaryCache(orgId);
  return { ok: true, ...result };
}

/** @deprecated Prefer {@link applyLeadDashboardGaugesDeltaServer}. */
export async function applyOpenSalesLeadsDeltaServer(
  organizationId: string,
  delta: number,
): Promise<{ ok: true; openSalesLeads: number } | { ok: false; error: string }> {
  const result = await applyLeadDashboardGaugesDeltaServer(organizationId, {
    openSalesLeads: delta,
  });
  if (!result.ok) return result;
  return { ok: true, openSalesLeads: result.openSalesLeads };
}

/** Diff before/after lead snapshots and apply open + idle sales-lead deltas. */
export async function syncLeadDashboardGaugesFromLeadChangeServer(input: {
  organizationId: string;
  before?: OpenSalesLeadFields | null;
  after?: OpenSalesLeadFields | null;
}): Promise<
  | {
      ok: true;
      openDelta: number;
      idleDelta: number;
      openSalesLeads: number;
      idleSalesLeads: number;
    }
  | { ok: false; error: string }
> {
  const openDelta = openSalesLeadsContributionDelta(input.before, input.after);
  const idleDelta = idleSalesLeadsContributionDelta(input.before, input.after);
  if (!openDelta && !idleDelta) {
    return {
      ok: true,
      openDelta: 0,
      idleDelta: 0,
      openSalesLeads: -1,
      idleSalesLeads: -1,
    };
  }
  const result = await applyLeadDashboardGaugesDeltaServer(input.organizationId, {
    openSalesLeads: openDelta,
    idleSalesLeads: idleDelta,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    openDelta,
    idleDelta,
    openSalesLeads: result.openSalesLeads,
    idleSalesLeads: result.idleSalesLeads,
  };
}

/** @deprecated Prefer {@link syncLeadDashboardGaugesFromLeadChangeServer}. */
export async function syncOpenSalesLeadsFromLeadChangeServer(input: {
  organizationId: string;
  before?: OpenSalesLeadFields | null;
  after?: OpenSalesLeadFields | null;
}): Promise<{ ok: true; delta: number; openSalesLeads: number } | { ok: false; error: string }> {
  const result = await syncLeadDashboardGaugesFromLeadChangeServer(input);
  if (!result.ok) return result;
  return { ok: true, delta: result.openDelta, openSalesLeads: result.openSalesLeads };
}

/**
 * Absolute recount of open + idle sales leads for an org (backfill / repair).
 * Prefer {@link recomputeOrgDashboardSummaryServer} for full KPI refresh.
 */
export async function recomputeOpenSalesLeadsServer(
  organizationId: string,
): Promise<
  | { ok: true; openSalesLeads: number; idleSalesLeads: number }
  | { ok: false; error: string }
> {
  const full = await recomputeOrgDashboardSummaryServer(organizationId);
  if (!full.ok) return full;
  return {
    ok: true,
    openSalesLeads: full.summary.openSalesLeads,
    idleSalesLeads: full.summary.idleSalesLeads,
  };
}

/**
 * Absolute recount of open pipeline gauges + stage distribution (P0.8 / P0.9).
 * Prefer {@link recomputeOrgDashboardSummaryServer} for full KPI refresh.
 */
export async function recomputeOpenPipelineGaugesServer(
  organizationId: string,
): Promise<
  | {
      ok: true;
      openPipelineValue: number;
      openDealCount: number;
      leadEstimateContributors: number;
      pipelineByStage: Record<string, number>;
    }
  | { ok: false; error: string }
> {
  const full = await recomputeOrgDashboardSummaryServer(organizationId);
  if (!full.ok) return full;
  const s = full.summary;
  return {
    ok: true,
    openPipelineValue: s.openPipelineValue,
    openDealCount: s.openDealCount,
    leadEstimateContributors: s.leadEstimateContributors,
    pipelineByStage: s.pipelineByStage,
  };
}

/**
 * Full org dashboard summary recount.
 * P3.4: when `DATABASE_URL` is set, Postgres is the system of record.
 * Firestore `orgDashboardSummaries` is written only when
 * `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1=true` (rollback).
 */
export async function recomputeOrgDashboardSummaryServer(
  organizationId: string,
): Promise<{ ok: true; summary: OrgDashboardSummary } | { ok: false; error: string }> {
  const orgId = organizationId.trim();
  if (!orgId) return { ok: false, error: "organizationId required" };

  if (isDatabaseConfigured()) {
    const { recomputeOrgDashboardSummaryPostgres } = await import(
      "@/lib/db/org-dashboard-summary-refresh"
    );
    const pg = await recomputeOrgDashboardSummaryPostgres(orgId);
    if (!pg.ok) return pg;

    if (isFirestoreOrgDashboardSummaryWriterEnabled()) {
      const written = await writeOrgDashboardSummaryToFirestore(pg.summary);
      if (!written.ok) {
        console.error("[dashboard-summary] FS rollback write failed", orgId, written.error);
      }
    }
    return pg;
  }

  // Legacy path when Postgres is not configured.
  return recomputeOrgDashboardSummaryFirestoreOnly(orgId);
}

async function writeOrgDashboardSummaryToFirestore(
  summary: OrgDashboardSummary,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getAdminDb();
  const ref = summaryRef(summary.organizationId);
  if (!db || !ref) return { ok: false, error: "Admin Firestore unavailable" };
  await ref.set(summary, { merge: true });
  await invalidateSummaryCache(summary.organizationId);
  return { ok: true };
}

async function recomputeOrgDashboardSummaryFirestoreOnly(
  orgId: string,
): Promise<{ ok: true; summary: OrgDashboardSummary } | { ok: false; error: string }> {
  const db = getAdminDb();
  const ref = summaryRef(orgId);
  if (!db || !ref) return { ok: false, error: "Admin Firestore unavailable" };

  const [leadsSnap, dealsSnap, followupsSnap, orgSnap] = await Promise.all([
    db.collection(COLLECTIONS.leads).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.deals).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.followups).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.organizations).doc(orgId).get(),
  ]);

  const leads = leadsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Lead[];
  const deals = dealsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Deal[];
  const followups = followupsSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Followup[];

  const orgData = orgSnap.exists ? (orgSnap.data() as Record<string, unknown>) : {};
  const settings =
    orgData.settings && typeof orgData.settings === "object"
      ? (orgData.settings as Record<string, unknown>)
      : {};
  const timeZone =
    typeof settings.timezone === "string" && settings.timezone.trim()
      ? settings.timezone.trim()
      : "UTC";

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

  await ref.set(summary, { merge: true });
  await invalidateSummaryCache(orgId);
  return { ok: true, summary };
}
