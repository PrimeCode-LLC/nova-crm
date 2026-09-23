import { describe, expect, it } from "vitest";

import type { Followup, Note } from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace-dataset-core";
import { emptyWorkspaceSession, mergeSessionIntoSnapshot } from "@/lib/workspace-session";

const base = {
  leads: [],
  accounts: [],
  contacts: [],
  deals: [],
  notes: [{ id: "n1", leadId: "lead-missing", body: "note" } as Note],
  followups: [{ id: "f1", leadId: "lead-missing", ownerId: "u1" } as Followup],
  followupPlans: [],
  leadTasks: [],
  touchpoints: [],
  timelineByLead: {},
  orgActivityEvents: [],
} as unknown as WorkspaceSnapshot;

describe("mergeSessionIntoSnapshot lead-link filter", () => {
  it("drops followups and notes whose lead is not in the loaded snapshot", () => {
    const merged = mergeSessionIntoSnapshot(base, emptyWorkspaceSession());
    expect(merged.followups).toEqual([]);
    expect(merged.notes).toEqual([]);
  });

  it("keeps those rows when lead rows are intentionally not loaded", () => {
    const merged = mergeSessionIntoSnapshot(base, emptyWorkspaceSession(), {
      keepUnloadedLeadLinks: true,
    });
    expect(merged.followups.map((f) => f.id)).toEqual(["f1"]);
    expect(merged.notes.map((n) => n.id)).toEqual(["n1"]);
  });
});
