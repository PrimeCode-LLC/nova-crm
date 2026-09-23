import { describe, expect, it } from "vitest";
import {
  canApplyOrgWideDashboardSummary,
  collectWorkflowLinkLeadIds,
  filterOptionalLeadRows,
  filterRequiredLeadRows,
  resolveDashboardKpiAccessScope,
  resolveDashboardKpiViewer,
  resolveWorkflowLeadGate,
  scopeDashboardEntitiesForKpiViewer,
  WORKFLOW_LINK_LEAD_CAP,
} from "@/lib/dashboard-kpi-scope";
import { computeDashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import { computeOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import type { OwnerScopeDeps } from "@/lib/owner-scope";
import type { Deal, Followup, Lead, User } from "@/lib/types";

const NOW = "2026-09-09T00:00:00.000Z";

function user(id: string, patch: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    roleId: "salesperson",
    status: "active",
    createdAt: NOW,
    ...patch,
  };
}

function lead(id: string, ownerId: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    organizationId: "org1",
    accountId: `acc-${id}`,
    contactId: `con-${id}`,
    ownerId,
    channel: "cold_email",
    stage: "new",
    estimatedValue: 1000,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  } as Lead;
}

function deal(id: string, leadId: string, value: number, patch: Partial<Deal> = {}): Deal {
  return {
    id,
    organizationId: "org1",
    leadId,
    accountId: `acc-${leadId}`,
    ownerId: "x",
    name: id,
    stage: "proposal",
    value,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  } as Deal;
}

describe("dashboard KPI scope gating", () => {
  it("org owner/admin/director may use org-wide summary when filters are unscoped", () => {
    for (const viewer of [
      user("owner", { orgRole: "owner", roleId: "director" }),
      user("admin", { orgRole: "admin", roleId: "manager" }),
      user("dir", { roleId: "director", orgRole: "member" }),
    ]) {
      expect(
        canApplyOrgWideDashboardSummary({
          viewer,
          channelScopeEmpty: true,
          ownerScopeIsAll: true,
        }),
      ).toBe(true);
      expect(resolveDashboardKpiAccessScope(viewer)).toBe("org");
    }
  });

  it("default all-owners does not grant org-wide KPIs to salesperson", () => {
    const salesperson = user("rep", { roleId: "salesperson", orgRole: "member" });
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: salesperson,
        channelScopeEmpty: true,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
    expect(resolveDashboardKpiAccessScope(salesperson)).toBe("own");
  });

  it("manager / team lead get team scope, not org-wide summary", () => {
    const manager = user("mgr", { roleId: "manager", orgRole: "manager" });
    const teamLead = user("tl", { roleId: "team_lead", orgRole: "member" });
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: manager,
        channelScopeEmpty: true,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
    expect(resolveDashboardKpiAccessScope(manager)).toBe("team");
    expect(resolveDashboardKpiAccessScope(teamLead)).toBe("team");
  });

  it("prospecting / data scraper are own-scoped", () => {
    expect(
      resolveDashboardKpiAccessScope(user("p", { roleId: "prospecting", orgRole: "member" })),
    ).toBe("own");
    expect(
      resolveDashboardKpiAccessScope(user("s", { roleId: "data_scraper", orgRole: "member" })),
    ).toBe("own");
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: user("p", { roleId: "prospecting" }),
        channelScopeEmpty: true,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
  });

  it("channel or owner filters disable org-wide summary even for directors", () => {
    const director = user("dir", { roleId: "director", orgRole: "owner" });
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: director,
        channelScopeEmpty: false,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: director,
        channelScopeEmpty: true,
        ownerScopeIsAll: false,
      }),
    ).toBe(false);
  });

  it("preview-as-salesperson uses salesperson KPI scope for a director", () => {
    const director = user("dir", { roleId: "director", orgRole: "owner" });
    expect(resolveDashboardKpiAccessScope(director, "salesperson")).toBe("own");
    expect(
      canApplyOrgWideDashboardSummary({
        viewer: director,
        previewRole: "salesperson",
        channelScopeEmpty: true,
        ownerScopeIsAll: true,
      }),
    ).toBe(false);
    const kpiViewer = resolveDashboardKpiViewer(director, "salesperson");
    expect(kpiViewer?.roleId).toBe("salesperson");
    expect(kpiViewer?.isSuperAdmin).toBe(false);
  });
});

describe("dashboard KPI scoped aggregation", () => {
  const director = user("dir", { roleId: "director", orgRole: "owner" });
  const manager = user("mgr", { roleId: "manager", orgRole: "manager" });
  const repA = user("repA", { roleId: "salesperson", managerId: manager.id });
  const repB = user("repB", { roleId: "salesperson", managerId: "other-mgr" });
  const roster = [director, manager, repA, repB, user("other-mgr", { roleId: "manager" })];

  const leads = [
    lead("l-a1", repA.id, { estimatedValue: 100 }),
    lead("l-a2", repA.id, { estimatedValue: 200, stage: "replied" }),
    lead("l-b1", repB.id, { estimatedValue: 9_000 }),
    lead("l-m1", manager.id, { estimatedValue: 50 }),
    lead("l-d1", director.id, { estimatedValue: 500 }),
  ];
  const deals = [
    deal("d-a1", "l-a1", 1000),
    deal("d-b1", "l-b1", 50_000),
    deal("d-m1", "l-m1", 200),
  ];

  it("salesperson KPIs exclude other owners' pipeline", () => {
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: repA,
      orgUsers: roster,
      leads,
      deals,
      followups: [],
      leadTasks: [],
    });
    expect(scoped.leads.map((l) => l.id).sort()).toEqual(["l-a1", "l-a2"]);
    const metrics = computeDashboardWorkflowMetrics({
      leads: scoped.leads,
      followups: [],
      plans: [],
      tasks: [],
      contacts: [],
      currentUserId: repA.id,
      range: "30d",
    });
    expect(metrics.openSalesLeads).toBe(2);
    const pipeline = computeOpenPipelineMetrics(
      scoped.leads.filter((l) => l.intakeKind !== "prospect"),
      scoped.deals,
    );
    expect(pipeline.total).toBeLessThan(9_000);
    expect(scoped.deals.some((d) => d.id === "d-b1")).toBe(false);
  });

  it("manager KPIs include reporting tree and exclude unrelated teams", () => {
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: manager,
      orgUsers: roster,
      leads,
      deals,
      followups: [],
      leadTasks: [],
    });
    const ids = scoped.leads.map((l) => l.id).sort();
    expect(ids).toContain("l-a1");
    expect(ids).toContain("l-a2");
    expect(ids).toContain("l-m1");
    expect(ids).not.toContain("l-b1");
    expect(ids).not.toContain("l-d1");
    expect(scoped.deals.some((d) => d.id === "d-b1")).toBe(false);
  });

  it("director with org access keeps full lead set for KPIs", () => {
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: director,
      orgUsers: roster,
      leads,
      deals,
      followups: [],
      leadTasks: [],
    });
    expect(scoped.leads).toHaveLength(leads.length);
    expect(scoped.deals).toHaveLength(deals.length);
  });

  it("KPI totals match scoped records (salesperson cannot receive org pipeline)", () => {
    const orgPipeline = computeOpenPipelineMetrics(
      leads.filter((l) => l.intakeKind !== "prospect"),
      deals,
    );
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: repA,
      orgUsers: roster,
      leads,
      deals,
      followups: [],
      leadTasks: [],
    });
    const personalPipeline = computeOpenPipelineMetrics(
      scoped.leads.filter((l) => l.intakeKind !== "prospect"),
      scoped.deals,
    );
    expect(orgPipeline.total).toBeGreaterThan(personalPipeline.total);
    // Deal on l-a1 ($1000) + estimatedValue on l-a2 with no open deal ($200)
    expect(personalPipeline.total).toBe(1200);
    expect(scoped.deals.reduce((s, d) => s + d.value, 0)).toBe(1000);
  });

  it("preview-as-salesperson scopes a director's KPI dataset to own leads", () => {
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: director,
      previewRole: "salesperson",
      orgUsers: roster,
      leads,
      deals,
      followups: [],
      leadTasks: [],
    });
    expect(scoped.leads.map((l) => l.id)).toEqual(["l-d1"]);
    expect(scoped.deals).toEqual([]);
  });

  it("prospecting assignee can see assigned prospect for KPIs", () => {
    const prospector = user("pro", { roleId: "prospecting", orgRole: "member" });
    const assigned = lead("p1", director.id, {
      intakeKind: "prospect",
      prospectAssigneeIds: [prospector.id],
      estimatedValue: 0,
    });
    const other = lead("p2", director.id, {
      intakeKind: "prospect",
      prospectAssigneeIds: ["someone-else"],
      estimatedValue: 0,
    });
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: prospector,
      orgUsers: [...roster, prospector],
      leads: [...leads, assigned, other],
      deals: [],
      followups: [],
      leadTasks: [],
    });
    expect(scoped.leads.map((l) => l.id)).toEqual(["p1"]);
  });
});

function followup(id: string, ownerId: string, leadId?: string): Followup {
  return {
    id,
    leadId,
    title: id,
    dueAt: NOW,
    ownerId,
    priority: "medium",
    auto: false,
  };
}

function ownerDeps(currentUserId: string, users: readonly User[]): OwnerScopeDeps {
  return {
    currentUserId,
    users,
    getUserById: (id) => users.find((row) => row.id === id),
    getOwnerDisplayName: (id) => users.find((row) => row.id === id)?.displayName,
  };
}

describe("workflow lead gate when the CRM snapshot is empty", () => {
  const director = user("dir", { roleId: "director", orgRole: "owner" });
  const rep = user("rep", { roleId: "salesperson", orgRole: "member" });
  const roster = [director, rep];
  const ownLead = lead("own", director.id);
  const otherLead = lead("other", rep.id, { channel: "linkedin_outbound" });
  const deps = ownerDeps(director.id, roster);

  it("snapshot-on keeps the full filtered lead set and ignores link leads", () => {
    const scopedLeadIds = new Set(["own"]);
    const gate = resolveWorkflowLeadGate({
      snapshotLeadsEmpty: false,
      scopedLeadIds,
      followups: [followup("f-other", rep.id, "other")],
      leadTasks: [],
      linkLeads: [ownLead, otherLead],
      viewer: director,
      orgUsers: roster,
      channelScope: [],
      ownerScope: "all-owners",
      ownerScopeDeps: deps,
      timeRange: "30d",
      now: new Date(NOW),
    });
    expect(gate.gateLeadIds).toBe(scopedLeadIds);
    expect([...gate.gateLeadIds]).toEqual(["own"]);
    expect(gate.followups.map((row) => row.id)).toEqual(["f-other"]);
  });

  it("empty snapshot leads still gate rows once link leads are supplied", () => {
    const rows = [
      followup("f-own", director.id, "own"),
      followup("f-other", rep.id, "other"),
      followup("f-loose", director.id),
    ];
    const gate = resolveWorkflowLeadGate({
      snapshotLeadsEmpty: true,
      scopedLeadIds: new Set(),
      followups: rows,
      leadTasks: [],
      linkLeads: [ownLead, otherLead],
      viewer: director,
      orgUsers: roster,
      channelScope: [],
      ownerScope: "all-owners",
      ownerScopeDeps: deps,
      timeRange: "30d",
      now: new Date(NOW),
    });
    expect([...gate.gateLeadIds].sort()).toEqual(["other", "own"]);
    const visible = filterOptionalLeadRows(gate.followups, gate.gateLeadIds);
    expect(visible.map((row) => row.id).sort()).toEqual(["f-loose", "f-other", "f-own"]);
  });

  it("preview-as-salesperson keeps only that viewer's lead follow-up, plus unlinked rows", () => {
    const rows = [
      followup("f-own", director.id, "own"),
      followup("f-other", rep.id, "other"),
      followup("f-loose", director.id),
    ];
    const gate = resolveWorkflowLeadGate({
      snapshotLeadsEmpty: true,
      scopedLeadIds: new Set(),
      followups: rows,
      leadTasks: [],
      linkLeads: [ownLead, otherLead],
      viewer: director,
      previewRole: "salesperson",
      orgUsers: roster,
      channelScope: [],
      ownerScope: "all-owners",
      ownerScopeDeps: deps,
      timeRange: "30d",
      now: new Date(NOW),
    });
    expect([...gate.gateLeadIds]).toEqual(["own"]);
    const visible = filterOptionalLeadRows(gate.followups, gate.gateLeadIds);
    expect(visible.map((row) => row.id).sort()).toEqual(["f-loose", "f-own"]);
    expect(filterRequiredLeadRows([{ leadId: "own" }, { leadId: "other" }, { leadId: "" }], gate.gateLeadIds)).toEqual([
      { leadId: "own" },
    ]);
  });

  it("keeps lead-linked follow-ups when the snapshot cutover has an empty lead list", () => {
    const sales = user("sales");
    const scoped = scopeDashboardEntitiesForKpiViewer({
      viewer: sales,
      orgUsers: [sales],
      leads: [],
      deals: [],
      followups: [followup("fu-1", sales.id, "lead-missing")],
      leadTasks: [],
      snapshotCutoverActive: true,
    });
    expect(scoped.followups.map((row) => row.id)).toEqual(["fu-1"]);
  });

  it("channel filter drops link leads outside the selected channel", () => {
    const gate = resolveWorkflowLeadGate({
      snapshotLeadsEmpty: true,
      scopedLeadIds: new Set(),
      followups: [],
      leadTasks: [],
      linkLeads: [ownLead, otherLead],
      viewer: director,
      orgUsers: roster,
      channelScope: ["cold_email"],
      ownerScope: "all-owners",
      ownerScopeDeps: deps,
      timeRange: "all",
      now: new Date(NOW),
    });
    expect([...gate.gateLeadIds]).toEqual(["own"]);
  });

  it("caps and dedupes workflow link lead ids", () => {
    const followups = Array.from({ length: WORKFLOW_LINK_LEAD_CAP + 5 }, (_, index) => ({
      leadId: index === 1 ? "lead-0" : `lead-${index}`,
    }));
    const ids = collectWorkflowLinkLeadIds({
      followups,
      leadTasks: [{ leadId: "task-extra" }],
      plans: [{ leadId: "  plan-extra  " }],
    });
    expect(ids).toHaveLength(WORKFLOW_LINK_LEAD_CAP);
    expect(ids.filter((id) => id === "lead-0")).toHaveLength(1);
    expect(ids).not.toContain("task-extra");
    expect(ids).not.toContain("plan-extra");
  });
});
