import { describe, expect, it } from "vitest";
import {
  hasMeaningfulStopMarker,
  scheduledFollowupStopReason,
} from "@/lib/email/scheduled-followup-stop";

describe("hasMeaningfulStopMarker", () => {
  it("rejects nullish and empty string", () => {
    expect(hasMeaningfulStopMarker(null)).toBe(false);
    expect(hasMeaningfulStopMarker(undefined)).toBe(false);
    expect(hasMeaningfulStopMarker("")).toBe(false);
    expect(hasMeaningfulStopMarker("   ")).toBe(false);
  });

  it("accepts ISO timestamps", () => {
    expect(hasMeaningfulStopMarker("2026-09-10T21:30:00.000Z")).toBe(true);
  });
});

describe("scheduledFollowupStopReason", () => {
  it("does not stop on empty-string pause/complete (UI/server mismatch)", () => {
    expect(
      scheduledFollowupStopReason({
        followupExists: true,
        pausedAt: "",
        completedAt: "",
        planStatus: "active",
      }),
    ).toBeUndefined();
  });

  it("stops on real pause and plan status", () => {
    expect(
      scheduledFollowupStopReason({
        followupExists: true,
        pausedAt: "2026-09-10T20:00:00.000Z",
        planStatus: "active",
      }),
    ).toBe("Follow-up paused");
    expect(
      scheduledFollowupStopReason({
        followupExists: true,
        planStatus: "completed",
      }),
    ).toBe("Sequence completed");
  });

  it("reports missing followup", () => {
    expect(scheduledFollowupStopReason({ followupExists: false })).toBe(
      "Follow-up no longer exists",
    );
  });
});
