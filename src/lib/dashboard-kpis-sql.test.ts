import { describe, expect, it } from "vitest";
import {
  buildSqlOwnerScopeFilter,
  dashboardRangeStartIso,
  fetchScopedLeadDealSqlAggregates,
} from "@/lib/dashboard-kpis-sql";
import { computeScopedDashboardKpis } from "@/lib/dashboard-kpis-server";
import type { User } from "@/lib/types";

const runDb = Boolean(process.env.DATABASE_URL?.trim());

describe("buildSqlOwnerScopeFilter", () => {
  const users: User[] = [
    {
      id: "u1",
      email: "a@x.com",
      displayName: "A",
      roleId: "salesperson",
      orgRole: "member",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "u2",
      email: "b@x.com",
      displayName: "B",
      roleId: "salesperson",
      orgRole: "member",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("marks unassigned as Node hierarchy fallback", () => {
    const f = buildSqlOwnerScopeFilter("unassigned", "u1", users);
    expect(f.needsNodeHierarchy).toBe(true);
  });

  it("expresses me scope in SQL", () => {
    const f = buildSqlOwnerScopeFilter("me", "u1", users);
    expect(f.needsNodeHierarchy).toBe(false);
  });
});

describe("dashboardRangeStartIso", () => {
  it("matches getDashboardRangeStart for 30d", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const iso = dashboardRangeStartIso("30d", "UTC", now);
    expect(iso).toBe(new Date("2026-05-16T12:00:00.000Z").toISOString());
  });
});

/**
 * Parity harness: org-wide director + all-owners compares Node scoped compute
 * pipeline fields to SQL aggregates.
 *
 * Accepted deltas (plan):
 * - Orgs above legacy 10k poll cap (N/A in DB fixture)
 * - Activity/trend caps (not in this harness)
 * - repliesPendingReview when SQL uses Node followup pass for review gates
 */
describe.skipIf(!runDb)("SQL vs computeScopedDashboardKpis parity", () => {
  it("pipeline and channel mix match for org-wide scope when org has CRM rows", async () => {
    const orgId = process.env.DASHBOARD_KPI_PARITY_ORG_ID?.trim();
    if (!orgId) return;

    const director: User = {
      id: "parity-dir",
      email: "parity@x.com",
      displayName: "Parity",
      roleId: "director",
      orgRole: "owner",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const { fetchKpiSlimLeadsForOrg, fetchKpiSlimDealsForOrg } = await import(
      "@/lib/dashboard-kpis-sql"
    );
    const { getOrgTimezoneServer } = await import("@/lib/org-timezone-server");
    const { listOrgUsersServer } = await import("@/lib/platform/hierarchy-access-server");

    const [leads, deals, users, timeZone] = await Promise.all([
      fetchKpiSlimLeadsForOrg(orgId),
      fetchKpiSlimDealsForOrg(orgId),
      listOrgUsersServer(orgId),
      getOrgTimezoneServer(orgId),
    ]);

    const range = "30d" as const;
    const node = computeScopedDashboardKpis({
      viewer: director,
      channels: [],
      ownerScope: "all-owners",
      range,
      leads,
      deals,
      followups: [],
      plans: [],
      leadTasks: [],
      contacts: [],
      users,
      timeZone,
    });

    const sql = await fetchScopedLeadDealSqlAggregates({
      organizationId: orgId,
      range,
      timeZone,
      channels: [],
      ownerScope: "all-owners",
      currentUserId: director.id,
      users,
    });

    expect(sql).not.toBeNull();
    expect(sql!.usedNodeFallback).toBe(false);
    expect(sql!.openPipelineValue).toBe(node.pipeline.openPipelineValue);
    expect(sql!.openDealCount).toBe(node.pipeline.openDealCount);
    expect(sql!.leadEstimateContributors).toBe(node.pipeline.leadEstimateContributors);
    expect(sql!.closedRevenue).toBe(node.closedRevenue);
    expect(sql!.wonDealCount).toBe(node.wonDealCount);
    expect(sql!.pipelineByStage).toEqual(node.pipelineByStage);
    expect(sql!.channelMix).toEqual(node.channelMix);
  });
});
