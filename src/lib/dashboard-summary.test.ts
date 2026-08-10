import { describe, expect, it } from "vitest";
import {
  ORG_DASHBOARD_SUMMARY_VERSION,
  computeOrgOpenPipelineGauges,
  computePipelineByStage,
  dealWriteAffectsOpenPipeline,
  emptyOrgDashboardSummary,
  emptyOrgDashboardSummaryRangeMetrics,
  idleSalesLeadsContributionDelta,
  leadCountsTowardIdleSalesLeads,
  leadCountsTowardOpenSalesLeads,
  leadWriteAffectsOpenPipeline,
  leadWriteAffectsPipelineByStage,
  openSalesLeadsContributionDelta,
  orgDashboardSummaryCacheKey,
  orgDashboardSummaryDocId,
  parseOrgDashboardSummary,
} from "@/lib/dashboard-summary";

describe("org dashboard summary schema", () => {
  it("builds a zeroed doc with id === organizationId", () => {
    const doc = emptyOrgDashboardSummary("org_abc", "2026-08-11T00:00:00.000Z");
    expect(doc.id).toBe("org_abc");
    expect(doc.organizationId).toBe("org_abc");
    expect(doc.version).toBe(ORG_DASHBOARD_SUMMARY_VERSION);
    expect(doc.openSalesLeads).toBe(0);
    expect(doc.pipelineByStage).toEqual({});
    expect(doc.channelMix).toEqual({});
    expect(doc.funnelByChannel).toEqual({});
    expect(doc.ranges).toEqual({});
    expect(orgDashboardSummaryDocId("org_abc")).toBe("org_abc");
    expect(orgDashboardSummaryCacheKey("org_abc")).toBe("dash:summary:v1:org_abc");
  });

  it("parses a valid payload including a range window", () => {
    const base = emptyOrgDashboardSummary("org_x", "2026-08-11T00:00:00.000Z");
    const raw = {
      ...base,
      openSalesLeads: 3,
      openPipelineValue: 12000,
      ranges: {
        "30d": {
          ...emptyOrgDashboardSummaryRangeMetrics(),
          sent: 10,
          replies: 2,
          closedRevenue: 5000,
          wonDealCount: 1,
        },
      },
    };
    expect(parseOrgDashboardSummary(raw)).toEqual(raw);
  });

  it("rejects mismatched id / organizationId and bad shapes", () => {
    const base = emptyOrgDashboardSummary("org_a");
    expect(parseOrgDashboardSummary({ ...base, id: "other" })).toBeNull();
    expect(parseOrgDashboardSummary({ ...base, version: 99 })).toBeNull();
    expect(parseOrgDashboardSummary({ ...base, openSalesLeads: -1 })).toBeNull();
    expect(parseOrgDashboardSummary(null)).toBeNull();
  });
});

describe("openSalesLeads / idleSalesLeads contribution (P0.4 / P0.7)", () => {
  it("counts open sales leads only", () => {
    expect(leadCountsTowardOpenSalesLeads({ stage: "new" })).toBe(true);
    expect(leadCountsTowardOpenSalesLeads({ intakeKind: "sales_lead", stage: "replied" })).toBe(
      true,
    );
    expect(leadCountsTowardOpenSalesLeads({ intakeKind: "prospect", stage: "new" })).toBe(false);
    expect(leadCountsTowardOpenSalesLeads({ stage: "won" })).toBe(false);
    expect(leadCountsTowardOpenSalesLeads({ stage: "lost" })).toBe(false);
    expect(leadCountsTowardOpenSalesLeads(null)).toBe(false);
  });

  it("counts idle sales leads only when open + isIdle", () => {
    expect(leadCountsTowardIdleSalesLeads({ stage: "new", isIdle: true })).toBe(true);
    expect(leadCountsTowardIdleSalesLeads({ stage: "new", isIdle: false })).toBe(false);
    expect(leadCountsTowardIdleSalesLeads({ stage: "won", isIdle: true })).toBe(false);
    expect(
      leadCountsTowardIdleSalesLeads({ intakeKind: "prospect", stage: "new", isIdle: true }),
    ).toBe(false);
  });

  it("computes create / stage / delete deltas", () => {
    expect(openSalesLeadsContributionDelta(null, { stage: "new" })).toBe(1);
    expect(openSalesLeadsContributionDelta(null, { intakeKind: "prospect", stage: "new" })).toBe(
      0,
    );
    expect(openSalesLeadsContributionDelta({ stage: "new" }, { stage: "won" })).toBe(-1);
    expect(
      openSalesLeadsContributionDelta({ stage: "won" }, { stage: "negotiation" }),
    ).toBe(1);
    expect(
      openSalesLeadsContributionDelta({ stage: "contacted" }, { stage: "replied" }),
    ).toBe(0);
    expect(openSalesLeadsContributionDelta({ stage: "new" }, null)).toBe(-1);
  });

  it("computes idle deltas independently of open when still open", () => {
    expect(
      idleSalesLeadsContributionDelta(
        { stage: "new", isIdle: false },
        { stage: "new", isIdle: true },
      ),
    ).toBe(1);
    expect(
      idleSalesLeadsContributionDelta(
        { stage: "new", isIdle: true },
        { stage: "won", isIdle: true },
      ),
    ).toBe(-1);
    expect(
      idleSalesLeadsContributionDelta(
        { stage: "new", isIdle: true },
        { stage: "new", isIdle: true },
      ),
    ).toBe(0);
  });
});

describe("open pipeline gauges (P0.8)", () => {
  it("sums open deals plus lead estimates without an open deal", () => {
    const gauges = computeOrgOpenPipelineGauges(
      [
        { id: "l1", stage: "new", estimatedValue: 1000 },
        { id: "l2", stage: "new", estimatedValue: 500 },
        { id: "l3", intakeKind: "prospect", stage: "new", estimatedValue: 999 },
        { id: "l4", stage: "won", estimatedValue: 2000 },
      ],
      [
        { leadId: "l2", stage: "negotiation", value: 8000 },
        { leadId: "l5", stage: "won", value: 50_000 },
      ],
    );
    // l1 estimate 1000 + deal on l2 8000 (l2 estimate ignored); prospect/won ignored
    expect(gauges.openPipelineValue).toBe(9000);
    expect(gauges.openDealCount).toBe(1);
    expect(gauges.leadEstimateContributors).toBe(1);
  });

  it("detects pipeline-affecting lead/deal field changes", () => {
    expect(
      leadWriteAffectsOpenPipeline(
        { id: "l1", stage: "new", estimatedValue: 1 },
        { id: "l1", stage: "new", estimatedValue: 2 },
      ),
    ).toBe(true);
    expect(
      leadWriteAffectsOpenPipeline(
        { id: "l1", stage: "new", estimatedValue: 1 },
        { id: "l1", stage: "new", estimatedValue: 1 },
      ),
    ).toBe(false);
    expect(
      dealWriteAffectsOpenPipeline(
        { leadId: "l1", stage: "new", value: 100 },
        { leadId: "l1", stage: "won", value: 100 },
      ),
    ).toBe(true);
  });
});

describe("pipeline by stage (P0.9)", () => {
  it("counts sales leads by stage and skips prospects", () => {
    expect(
      computePipelineByStage([
        { id: "a", stage: "new" },
        { id: "b", stage: "new" },
        { id: "c", stage: "replied" },
        { id: "d", intakeKind: "prospect", stage: "new" },
        { id: "e", stage: null },
      ]),
    ).toEqual({ new: 3, replied: 1 });
  });

  it("defaults missing pipelineByStage on parse", () => {
    const base = emptyOrgDashboardSummary("org_x", "2026-08-11T00:00:00.000Z");
    const { pipelineByStage: _drop, ...without } = base;
    const parsed = parseOrgDashboardSummary(without);
    expect(parsed?.pipelineByStage).toEqual({});
  });

  it("detects stage / intake changes only", () => {
    expect(
      leadWriteAffectsPipelineByStage(
        { id: "l1", stage: "new", estimatedValue: 1 },
        { id: "l1", stage: "new", estimatedValue: 99 },
      ),
    ).toBe(false);
    expect(
      leadWriteAffectsPipelineByStage(
        { id: "l1", stage: "new" },
        { id: "l1", stage: "replied" },
      ),
    ).toBe(true);
    expect(
      leadWriteAffectsPipelineByStage(
        { id: "l1", intakeKind: "prospect", stage: "new" },
        { id: "l1", intakeKind: "sales_lead", stage: "new" },
      ),
    ).toBe(true);
  });
});

describe("channel mix + apply (P0.10)", () => {
  it("counts sales leads and wins per channel", async () => {
    const { computeChannelMix } = await import("@/lib/dashboard-summary-compute");
    expect(
      computeChannelMix([
        { channel: "cold_email", stage: "new" },
        { channel: "cold_email", stage: "won" },
        { channel: "upwork", stage: "replied" },
        { channel: "upwork", stage: "won", intakeKind: "prospect" },
      ]),
    ).toEqual({
      cold_email: { count: 2, won: 1 },
      upwork: { count: 1, won: 0 },
    });
  });

  it("applies summary scalars and range windows onto live metrics", async () => {
    const { applyOrgDashboardSummaryToWorkflowMetrics } = await import(
      "@/lib/dashboard-summary-apply"
    );
    const base = emptyOrgDashboardSummary("org_z", "2026-08-11T00:00:00.000Z");
    const summary = {
      ...base,
      openSalesLeads: 9,
      prospects: 4,
      ranges: {
        "30d": {
          ...emptyOrgDashboardSummaryRangeMetrics(),
          sent: 12,
          replies: 3,
          opens: 5,
        },
      },
    };
    const live = {
      openSalesLeads: 1,
      idleSalesLeads: 0,
      prospects: 0,
      prospectsNeedRouting: 0,
      prospectsReadyToPush: 0,
      prospectsPushed: 0,
      prospectsNeedSequence: 0,
      followupsDue: 0,
      overdueFollowups: 0,
      scheduledSteps: 0,
      readyUnscheduledSteps: 0,
      sentInRange: 99,
      failedDeliveries: 0,
      retryingDeliveries: 0,
      bouncedEmailsInRange: 0,
      openBounceReviewTasks: 0,
      opensInRange: 99,
      activeSequences: 0,
      remainingSequenceSteps: 0,
      pausedOnReply: 0,
      totalReplies: 0,
      repliesInRange: 99,
      repliesPendingReview: 0,
      myOpenTasks: 7,
      overdueTasks: 2,
      waitingOnOthers: 1,
    };
    const next = applyOrgDashboardSummaryToWorkflowMetrics(live, summary, "30d");
    expect(next.openSalesLeads).toBe(9);
    expect(next.prospects).toBe(4);
    expect(next.sentInRange).toBe(12);
    expect(next.repliesInRange).toBe(3);
    expect(next.opensInRange).toBe(5);
    expect(next.myOpenTasks).toBe(7);
  });
});
