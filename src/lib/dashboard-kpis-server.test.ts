import { describe, expect, it } from "vitest";
import {
  buildDashboardKpiCacheKey,
  computeScopedDashboardKpis,
  DASHBOARD_KPI_CACHE_ENGINE_VERSION,
  resolveSafePreviewRole,
} from "@/lib/dashboard-kpis-server";
import { canApplyOrgWideDashboardSummary } from "@/lib/dashboard-kpi-scope";
import { applyOrgDashboardSummaryToWorkflowMetrics } from "@/lib/dashboard-summary-apply";
import { computeDashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import type { Deal, Followup, FollowupPlan, Lead, LeadTask, User } from "@/lib/types";

function lead(partial: Partial<Lead> & { id: string }): Lead {
  return {
    accountId: "a1",
    contactId: "c1",
    channel: "website_form",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    ownerId: "u-sales",
    contactName: "Test",
    companyName: "Co",
    touches: 0,
    isIdle: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Lead;
}

const director: User = {
  id: "u-dir",
  email: "d@x.com",
  displayName: "Dir",
  roleId: "director",
  orgRole: "owner",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const sales: User = {
  id: "u-sales",
  email: "s@x.com",
  displayName: "Sales",
  roleId: "salesperson",
  orgRole: "member",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("computeScopedDashboardKpis parity", () => {
  const leads: Lead[] = [
    lead({ id: "l1", ownerId: "u-sales", stage: "new", intakeKind: undefined }),
    lead({
      id: "l2",
      ownerId: "u-other",
      stage: "qualified",
      channel: "linkedin_outbound",
    }),
    lead({
      id: "l3",
      ownerId: "u-sales",
      stage: "new",
      intakeKind: "prospect",
    }),
  ];
  const deals: Deal[] = [];
  const followups: Followup[] = [];
  const plans: FollowupPlan[] = [];
  const leadTasks: LeadTask[] = [];
  const users = [director, sales];

  it("matches client workflow compute for org-wide director scope", () => {
    const server = computeScopedDashboardKpis({
      viewer: director,
      channels: [],
      ownerScope: "all-owners",
      range: "30d",
      leads,
      deals,
      followups,
      plans,
      leadTasks,
      contacts: [],
      users,
      timeZone: "UTC",
    });
    const client = computeDashboardWorkflowMetrics({
      leads,
      followups,
      plans,
      tasks: leadTasks,
      currentUserId: director.id,
      range: "30d",
      timeZone: "UTC",
    });
    expect(server.workflow.openSalesLeads).toBe(client.openSalesLeads);
    expect(server.workflow.prospects).toBe(client.prospects);
  });

  it("narrows to own leads for salesperson", () => {
    const server = computeScopedDashboardKpis({
      viewer: sales,
      channels: [],
      ownerScope: "all-owners",
      range: "30d",
      leads,
      deals,
      followups,
      plans,
      leadTasks,
      contacts: [],
      users,
      timeZone: "UTC",
    });
    // Hierarchy own-scope: only u-sales owned non-prospect open sales leads
    expect(server.workflow.openSalesLeads).toBe(1);
    expect(server.workflow.prospects).toBe(1);
  });

  it("applies channel filter", () => {
    const server = computeScopedDashboardKpis({
      viewer: director,
      channels: ["linkedin_outbound"],
      ownerScope: "all-owners",
      range: "30d",
      leads,
      deals,
      followups,
      plans,
      leadTasks,
      contacts: [],
      users,
      timeZone: "UTC",
    });
    expect(server.workflow.openSalesLeads).toBe(1);
  });

  it("applies ownerScope=me", () => {
    const server = computeScopedDashboardKpis({
      viewer: director,
      channels: [],
      ownerScope: "me",
      range: "30d",
      leads,
      deals,
      followups,
      plans,
      leadTasks,
      contacts: [],
      users,
      timeZone: "UTC",
    });
    // director id owns none of the fixtures
    expect(server.workflow.openSalesLeads).toBe(0);
  });

  it("matches client workflow across ranges", () => {
    const ranges = ["today", "12h", "1d", "7d", "30d", "90d", "qtd", "ytd", "all"] as const;
    for (const range of ranges) {
      const server = computeScopedDashboardKpis({
        viewer: director,
        channels: [],
        ownerScope: "all-owners",
        range,
        leads,
        deals,
        followups,
        plans,
        leadTasks,
        contacts: [],
        users,
        timeZone: "UTC",
      });
      const client = computeDashboardWorkflowMetrics({
        leads,
        followups,
        plans,
        tasks: leadTasks,
        currentUserId: director.id,
        range,
        timeZone: "UTC",
      });
      expect(server.workflow.openSalesLeads, range).toBe(client.openSalesLeads);
      expect(server.workflow.prospects, range).toBe(client.prospects);
    }
  });
});

describe("buildDashboardKpiCacheKey", () => {
  const base = {
    orgId: "org_a",
    uid: "uid_1",
    previewRole: "",
    channels: "",
    ownerScope: "all-owners",
    range: "30d",
  };

  it("includes the KPI cache engine version", () => {
    const key = buildDashboardKpiCacheKey(base);
    expect(key.startsWith(`dash:kpi:${DASHBOARD_KPI_CACHE_ENGINE_VERSION}:`)).toBe(true);
  });

  it("varies by uid, previewRole, channels, ownerScope, and range", () => {
    const key = buildDashboardKpiCacheKey(base);
    expect(buildDashboardKpiCacheKey({ ...base, uid: "uid_2" })).not.toBe(key);
    expect(buildDashboardKpiCacheKey({ ...base, previewRole: "manager" })).not.toBe(key);
    expect(buildDashboardKpiCacheKey({ ...base, channels: "website_form" })).not.toBe(key);
    expect(buildDashboardKpiCacheKey({ ...base, ownerScope: "u-sales" })).not.toBe(key);
    expect(buildDashboardKpiCacheKey({ ...base, range: "7d" })).not.toBe(key);
  });
});

describe("resolveSafePreviewRole", () => {
  it("drops a preview role that would widen the session scope", () => {
    expect(resolveSafePreviewRole(sales, "director")).toBeNull();
    expect(resolveSafePreviewRole(sales, "manager")).toBeNull();
  });

  it("keeps a preview role that narrows the session scope", () => {
    expect(resolveSafePreviewRole(director, "salesperson")).toBe("salesperson");
    expect(resolveSafePreviewRole(director, "manager")).toBe("manager");
  });

  it("ignores a preview role equal to the viewer's own role", () => {
    expect(resolveSafePreviewRole(director, "director")).toBeNull();
    expect(resolveSafePreviewRole(sales, null)).toBeNull();
  });

  it("does not let an escalated preview reach org-wide summary scope", () => {
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: sales,
        previewRole: resolveSafePreviewRole(sales, "director"),
        channelScopeEmpty: true,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
  });
});

describe("org-wide summary overlay keeps fields the summary omits", () => {
  it("preserves live metrics outside the summary field set", () => {
    const live = computeDashboardWorkflowMetrics({
      leads: [lead({ id: "l9", ownerId: "u-sales", stage: "new" })],
      followups: [],
      plans: [],
      tasks: [],
      currentUserId: director.id,
      range: "90d",
    });
    const liveWithSequences = { ...live, activeSequences: 7, pausedOnReply: 3 };
    const summary = {
      updatedAt: "2026-01-01T00:00:00.000Z",
      openSalesLeads: 42,
      ranges: {},
    } as unknown as Parameters<typeof applyOrgDashboardSummaryToWorkflowMetrics>[1];

    const overlaid = applyOrgDashboardSummaryToWorkflowMetrics(
      liveWithSequences,
      summary,
      "90d",
      null,
    );

    expect(overlaid.openSalesLeads).toBe(42);
    // 90d is not a precomputed summary range � live values must survive.
    expect(overlaid.activeSequences).toBe(7);
    expect(overlaid.pausedOnReply).toBe(3);
  });
});
