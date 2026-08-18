import { describe, expect, it } from "vitest";

import {
  emptyOrgDashboardSummary,
  type OrgDashboardSummary,
} from "@/lib/dashboard-summary";
import {
  emptyOrgDashboardSummaryRowData,
  orgDashboardSummaryFromRow,
  orgDashboardSummaryToRowData,
} from "@/lib/db/org-dashboard-summary-postgres";
import type { OrgDashboardSummary as OrgDashboardSummaryRow } from "@/generated/prisma/client";

function asRow(
  data: ReturnType<typeof orgDashboardSummaryToRowData>,
): OrgDashboardSummaryRow {
  return data as unknown as OrgDashboardSummaryRow;
}

describe("org dashboard summary postgres mapping (P3.1)", () => {
  it("round-trips empty summary", () => {
    const domain = emptyOrgDashboardSummary("org_x", "2026-08-11T12:00:00.000Z");
    const row = asRow(orgDashboardSummaryToRowData(domain));
    expect(orgDashboardSummaryFromRow(row)).toEqual(domain);
  });

  it("round-trips nested maps and ranges", () => {
    const domain: OrgDashboardSummary = {
      ...emptyOrgDashboardSummary("org_y", "2026-08-11T12:00:00.000Z"),
      openSalesLeads: 3,
      openPipelineValue: 1200.5,
      pipelineByStage: { new: 2, qualified: 1 },
      channelMix: { email: { count: 2, won: 1 } },
      funnelByChannel: { email: { new: 1, won: 1 } },
      ranges: {
        "30d": {
          sent: 10,
          replies: 2,
          opens: 4,
          bounced: 0,
          closedRevenue: 500,
          wonDealCount: 1,
        },
      },
    };
    const row = asRow(orgDashboardSummaryToRowData(domain));
    expect(orgDashboardSummaryFromRow(row)).toEqual(domain);
  });

  it("emptyOrgDashboardSummaryRowData seeds zeros", () => {
    const data = emptyOrgDashboardSummaryRowData(
      "org_z",
      new Date("2026-08-11T00:00:00.000Z"),
    );
    expect(data.organizationId).toBe("org_z");
    expect(data.openSalesLeads).toBe(0);
    expect(data.pipelineByStage).toEqual({});
    expect(data.ranges).toEqual({});
  });

  it("rejects id / organizationId mismatch", () => {
    const bad = {
      ...emptyOrgDashboardSummary("org_a"),
      id: "other",
    };
    expect(() => orgDashboardSummaryToRowData(bad)).toThrow(/id must equal/);
  });
});
