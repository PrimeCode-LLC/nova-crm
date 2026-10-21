import { describe, expect, it } from "vitest";

import { aggregateAuditAnalytics } from "@/lib/audit-analytics";
import {
  mergeStageHistoryEntries,
  timelineRowToStageEntry,
  type StageHistoryEntry,
} from "@/lib/audit-stage-history";
import type { AuditLogRecord } from "@/lib/documents/audit";

function audit(at: string, prev: string, next: string, actor = "u1"): StageHistoryEntry {
  return {
    id: `audit:${at}`, source: "audit", at, actorUid: actor, actorName: "Zain", kind: "stage_changed",
    prevStage: prev, nextStage: next, summary: `${prev} → ${next}`,
  };
}

describe("stage history (QA 2.5)", () => {
  it("shows one stage move once even when audit and timeline both logged it (LEAD-04)", () => {
    const timeline = timelineRowToStageEntry({
      id: "te1", type: "stage_changed", actorId: "u1", createdAt: "2026-10-21T10:00:01.500Z",
      summary: "Moved from Qualified → Negotiation",
    })!;
    const merged = mergeStageHistoryEntries([audit("2026-10-21T10:00:00.000Z", "Qualified", "Negotiation"), timeline]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("audit");
  });

  it("keeps genuinely separate moves (other actor, or later)", () => {
    const merged = mergeStageHistoryEntries([
      audit("2026-10-21T10:00:00.000Z", "Qualified", "Negotiation"),
      audit("2026-10-21T10:30:00.000Z", "Negotiation", "Qualified"),
      timelineRowToStageEntry({
        id: "te2", type: "stage_changed", actorId: "u2", createdAt: "2026-10-21T10:00:01.000Z",
        summary: "Moved from Qualified → Negotiation",
      })!,
    ]);
    expect(merged).toHaveLength(3);
  });

  it("includes push-to-sales and move-back milestones (PROS-09)", () => {
    const pushed = timelineRowToStageEntry({
      id: "te3", type: "prospect_channel_pushed", actorId: "u1", createdAt: "2026-10-21T10:00:00.000Z",
      summary: "Channel pushed to shared lead (cold_email)",
    });
    const back = timelineRowToStageEntry({
      id: "te4", type: "lead_moved_back_to_prospect", actorId: "u1", createdAt: "2026-10-21T11:00:00.000Z",
      summary: "Sales lead undone — returned to prospect", payload: { previousStage: "contacted" },
    });
    expect(pushed).toMatchObject({ kind: "pushed", summary: "Channel pushed to shared lead (cold_email)" });
    expect(back).toMatchObject({ kind: "moved_back", prevStage: "contacted", nextStage: "prospect" });
    expect(timelineRowToStageEntry({ id: "x", type: "note_added", summary: "", createdAt: "" })).toBeNull();
  });
});

describe("activity counters (QA 2.5 / DASH-06)", () => {
  it("counts batch lead.created rows by meta.count", () => {
    const rows = [
      { id: "a", organizationId: "o", actorUid: "u1", event: "lead.created", meta: { count: 250 }, createdAt: "2026-10-21T10:00:00.000Z" },
      { id: "b", organizationId: "o", actorUid: "u1", event: "lead.created", meta: { leadId: "l1" }, createdAt: "2026-10-21T10:01:00.000Z" },
      { id: "c", organizationId: "o", actorUid: "u1", event: "deal.won", meta: { dealId: "d1" }, createdAt: "2026-10-21T10:02:00.000Z" },
    ] as unknown as AuditLogRecord[];
    const result = aggregateAuditAnalytics(rows);
    expect(result.kpis.leadsCreated).toBe(251);
    expect(result.kpis.dealsWon).toBe(1);
  });
});
