/**
 * P3.3 — read `org_dashboard_summaries` (Redis → Postgres + RLS).
 */

import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheDel,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import {
  ORG_DASHBOARD_SUMMARY_VERSION,
  parseOrgDashboardSummary,
  type OrgDashboardSummary,
} from "@/lib/dashboard-summary";
import { orgDashboardSummaryFromRow } from "@/lib/db/org-dashboard-summary-postgres";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope } from "@/lib/db/tenant-scope";

/** Redis key for Postgres-backed summaries (separate from Firestore Phase 0 cache). */
export function orgDashboardSummaryPostgresCacheKey(organizationId: string): string {
  return `dash:summary:pg:v${ORG_DASHBOARD_SUMMARY_VERSION}:${organizationId}`;
}

export async function invalidateOrgDashboardSummaryPostgresCache(
  organizationId: string,
): Promise<void> {
  if (!isRedisConfigured()) return;
  const orgId = organizationId.trim();
  if (!orgId) return;
  try {
    await cacheDel(orgDashboardSummaryPostgresCacheKey(orgId));
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] redis invalidate failed",
      orgId,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Tenant-scoped read: Redis → Postgres.
 * Returns null when missing / invalid / DATABASE_URL unset.
 */
export async function getOrgDashboardSummaryFromPostgres(
  organizationId: string,
): Promise<{ summary: OrgDashboardSummary; source: "redis" | "postgres" } | null> {
  const orgId = organizationId.trim();
  if (!orgId) return null;
  if (!isDatabaseConfigured()) return null;

  const cacheKey = orgDashboardSummaryPostgresCacheKey(orgId);
  if (isRedisConfigured()) {
    const cached = await cacheGetJson<OrgDashboardSummary>(cacheKey);
    const parsed = parseOrgDashboardSummary(cached);
    if (parsed) return { summary: parsed, source: "redis" };
  }

  try {
    const row = await withOrganizationScope(orgId, (tx) =>
      tx.orgDashboardSummary.findUnique({ where: { organizationId: orgId } }),
    );
    if (!row) return null;
    const summary = orgDashboardSummaryFromRow(row);
    if (!summary) return null;
    if (isRedisConfigured()) {
      await cacheSetJson(cacheKey, summary, DEFAULT_CACHE_TTL_SECONDS);
    }
    return { summary, source: "postgres" };
  } catch (err) {
    console.error(
      "[pg-dashboard-summary] read failed",
      orgId,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
