import { describe, expect, it } from "vitest";
import { buildOpsActivityFeed } from "@/lib/dashboard-ops-analytics";
import {
  buildBulkLeadOrgActivity,
  summarizeBulkLeadOrgActivity,
} from "@/lib/leads/record-bulk-lead-org-activity";

describe("summarizeBulkLeadOrgActivity", () => {
  it("summarizes sequence builds", () => {
    expect(
      summarizeBulkLeadOrgActivity({ type: "leads_sequences_built", count: 1, leadLabel: "Ada (Acme)" }),
    ).toBe("Built sequence for “Ada (Acme)”");
    expect(summarizeBulkLeadOrgActivity({ type: "leads_sequences_built", count: 24 })).toBe(
      "Built 24 sequences",
    );
  });

  it("summarizes sequence schedules with email counts", () => {
    expect(
      summarizeBulkLeadOrgActivity({
        type: "leads_sequences_scheduled",
        count: 3,
        emailCount: 12,
      }),
    ).toBe("Scheduled sequences for 3 leads (12 emails)");
  });

  it("summarizes deletes", () => {
    expect(summarizeBulkLeadOrgActivity({ type: "leads_deleted", count: 1 })).toBe("Deleted 1 lead");
    expect(summarizeBulkLeadOrgActivity({ type: "leads_deleted", count: 5 })).toBe("Deleted 5 leads");
  });
});

describe("buildOpsActivityFeed bulk lead org events", () => {
  it("includes bulk lead summary rows", () => {
    const built = {
      ...buildBulkLeadOrgActivity({
        type: "leads_sequences_built",
        actorId: "u1",
        count: 4,
      })!,
      createdAt: "2026-08-06T10:00:03.000Z",
    };
    const scheduled = {
      ...buildBulkLeadOrgActivity({
        type: "leads_sequences_scheduled",
        actorId: "u1",
        count: 2,
        emailCount: 6,
      })!,
      createdAt: "2026-08-06T10:00:02.000Z",
    };
    const deleted = {
      ...buildBulkLeadOrgActivity({
        type: "leads_deleted",
        actorId: "u1",
        count: 3,
      })!,
      createdAt: "2026-08-06T10:00:01.000Z",
    };

    const feed = buildOpsActivityFeed({
      timelineByLead: {},
      orgActivityEvents: [built, scheduled, deleted],
      limit: 10,
    });

    expect(feed.map((f) => f.type)).toEqual([
      "leads_sequences_built",
      "leads_sequences_scheduled",
      "leads_deleted",
    ]);
    expect(feed[0]?.summary).toBe("Built 4 sequences");
    expect(feed[1]?.summary).toBe("Scheduled sequences for 2 leads (6 emails)");
    expect(feed[2]?.summary).toBe("Deleted 3 leads");
  });
});
