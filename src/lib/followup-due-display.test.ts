import { describe, expect, it } from "vitest";
import {
  dueAtForReschedulePreset,
  formatFollowupDueLabel,
  isFollowupRetryable,
  nextWeekdayYmd,
} from "@/lib/followup-due-display";

describe("formatFollowupDueLabel", () => {
  const tz = "America/New_York";

  it("shows time + relative for due today", () => {
    const due = "2026-08-04T18:00:00.000Z"; // afternoon EDT on Aug 4
    const { label } = formatFollowupDueLabel(due, "today", tz, {
      isViewToday: true,
      now: new Date("2026-08-04T14:00:00.000Z"),
    });
    expect(label).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    expect(label).toMatch(/ago|in /i);
  });

  it("includes date for overdue", () => {
    const due = "2026-08-03T18:00:00.000Z";
    const { label } = formatFollowupDueLabel(due, "overdue", tz, {
      now: new Date("2026-08-04T14:00:00.000Z"),
    });
    expect(label).toMatch(/Aug/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("dueAtForReschedulePreset", () => {
  const tz = "America/New_York";
  const now = new Date("2026-08-04T16:00:00.000Z"); // noon-ish EDT

  it("adds one hour from now", () => {
    const iso = dueAtForReschedulePreset("plus1h", tz, { now });
    expect(new Date(iso).getTime()).toBe(now.getTime() + 60 * 60 * 1000);
  });

  it("schedules tomorrow 9 AM in zone", () => {
    const iso = dueAtForReschedulePreset("tomorrow9", tz, { now });
    const label = formatFollowupDueLabel(iso, "later", tz, { now });
    expect(label.label).toMatch(/Aug 5/);
    expect(label.label).toMatch(/9:00/);
  });
});

describe("nextWeekdayYmd", () => {
  it("returns next Monday after a Tuesday", () => {
    expect(nextWeekdayYmd("2026-08-04", 1, "UTC")).toBe("2026-08-10");
  });
});

describe("isFollowupRetryable", () => {
  it("requires scheduled email id and failed/retry status", () => {
    expect(isFollowupRetryable({ deliveryStatus: "failed" })).toBe(false);
    expect(
      isFollowupRetryable({ deliveryStatus: "failed", scheduledEmailId: "s1" }),
    ).toBe(true);
    expect(
      isFollowupRetryable({ deliveryStatus: "scheduled", scheduledEmailId: "s1" }),
    ).toBe(false);
  });
});
