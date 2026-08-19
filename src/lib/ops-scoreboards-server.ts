/**
 * Ops scoreboards — Admin SDK load + Redis cache (P0.13).
 * Reuses pure builders; does not put large row payloads into orgDashboardSummaries.
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { buildInboxPerformanceRows, buildOpsScorecardRows } from "@/lib/dashboard-ops-analytics";
import { buildTeamCommandRows } from "@/lib/dashboard-team-command";
import { buildStrategyScoreboardRows } from "@/lib/dashboard-strategy-scoreboard";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import type {
  Deal,
  Followup,
  Lead,
  LeadTask,
} from "@/lib/types";
import type {
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import {
  isOpsScoreboardsRange,
  opsScoreboardsCacheKey,
  type OpsScoreboardsPayload,
} from "@/lib/ops-scoreboards";

export type { OpsScoreboardsPayload } from "@/lib/ops-scoreboards";
export { opsScoreboardsCacheKey, isOpsScoreboardsRange } from "@/lib/ops-scoreboards";

async function loadOrgOutreachThreshold(organizationId: string): Promise<number> {
  const db = getAdminDb();
  if (!db) return 45;
  const snap = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!snap.exists) return 45;
  const data = snap.data() as Record<string, unknown>;
  const playbook =
    data.intentPlaybook && typeof data.intentPlaybook === "object"
      ? (data.intentPlaybook as Record<string, unknown>)
      : null;
  const threshold = playbook?.outreachThreshold;
  return typeof threshold === "number" && Number.isFinite(threshold)
    ? Math.max(0, Math.min(100, Math.round(threshold)))
    : 45;
}

export async function getOpsScoreboardsServer(
  organizationId: string,
  range: DashboardTimeRangeKey,
): Promise<{ payload: OpsScoreboardsPayload; source: "redis" | "documents" } | null> {
  const orgId = organizationId.trim();
  if (!orgId || !isOpsScoreboardsRange(range)) return null;

  const cacheKey = opsScoreboardsCacheKey(orgId, range);
  if (isRedisConfigured()) {
    const cached = await cacheGetJson<OpsScoreboardsPayload>(cacheKey);
    if (cached && Array.isArray(cached.teamCommand) && cached.range === range) {
      return { payload: cached, source: "redis" };
    }
  }

  const db = getAdminDb();
  if (!db) return null;

  const [
    users,
    timeZone,
    outreachThreshold,
    leadsSnap,
    dealsSnap,
    followupsSnap,
    tasksSnap,
    strategiesSnap,
    assignmentsSnap,
  ] = await Promise.all([
    listOrgUsersServer(orgId),
    getOrgTimezoneServer(orgId),
    loadOrgOutreachThreshold(orgId),
    db.collection(COLLECTIONS.leads).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.deals).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.followups).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.leadTasks).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.prospectingStrategies).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.strategyAssignments).where("organizationId", "==", orgId).get(),
  ]);

  const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Lead[];
  const deals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Deal[];
  const followups = followupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Followup[];
  const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeadTask[];
  const strategies = strategiesSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as ProspectingStrategy[];
  const assignments = assignmentsSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as StrategyAssignment[];

  const teamCommand = buildTeamCommandRows({
    users,
    leads,
    deals,
    followups,
    tasks,
    range,
    outreachThreshold,
    timeZone,
  });
  const strategy = buildStrategyScoreboardRows({
    strategies,
    assignments,
    leads,
    deals,
    followups,
    range,
    outreachThreshold,
    timeZone,
  });
  const inbox = buildInboxPerformanceRows({
    users,
    leads,
    followups,
    range,
    timeZone,
    limit: 10,
  });
  const opsScorecard = buildOpsScorecardRows({
    users,
    leads,
    deals,
    followups,
    tasks,
    range,
    timeZone,
  });

  const payload: OpsScoreboardsPayload = {
    range,
    outreachThreshold,
    teamCommand,
    strategy,
    inbox,
    opsScorecard,
    updatedAt: new Date().toISOString(),
  };

  if (isRedisConfigured()) {
    try {
      await cacheSetJson(cacheKey, payload, DEFAULT_CACHE_TTL_SECONDS);
    } catch (err) {
      console.error("[ops-scoreboards] redis set failed", orgId, range, err);
    }
  }

  return { payload, source: "documents" };
}
