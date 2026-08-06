import { describe, expect, it } from "vitest";
import {
  getDashboardRangeStart,
  filterActivityRecordsByDateRange,
  buildDashboardHref,
  buildDashboardWallHref,
  parseDashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import type { ActivityRecord } from "@/lib/types";

describe("buildDashboardWallHref / buildDashboardHref", () => {
  it("carries the selected range into wall mode", () => {
    expect(buildDashboardWallHref("today")).toBe("/dashboard/wall?range=today");
    expect(buildDashboardWallHref("30d")).toBe("/dashboard/wall?range=30d");
  });

  it("round-trips range back to overview", () => {
    expect(buildDashboardHref("today")).toBe("/dashboard?range=today");
    expect(buildDashboardHref()).toBe("/dashboard");
  });

  it("parses wall query range with a safe fallback", () => {
    expect(parseDashboardTimeRangeKey("today")).toBe("today");
    expect(parseDashboardTimeRangeKey("nope", "30d")).toBe("30d");
  });
});

describe("getDashboardRangeStart today vs 1d", () => {
  // 2026-07-29 02:00 UTC = Jul 28 evening EDT, Jul 29 morning PKT
  const now = new Date("2026-07-29T02:00:00.000Z");

  it("today uses start of calendar day in org timezone", () => {
    const ny = getDashboardRangeStart("today", { now, timeZone: "America/New_York" });
    const karachi = getDashboardRangeStart("today", { now, timeZone: "Asia/Karachi" });

    // NY “today” is Jul 28 EDT (midnight EDT = 04:00 UTC)
    expect(ny.toISOString()).toBe("2026-07-28T04:00:00.000Z");
    // Karachi “today” is Jul 29 PKT (midnight PKT = Jul 28 19:00 UTC)
    expect(karachi.toISOString()).toBe("2026-07-28T19:00:00.000Z");
    expect(ny.getTime()).toBeLessThan(karachi.getTime());
  });

  it("1d is a rolling 24h window independent of timezone", () => {
    const ny = getDashboardRangeStart("1d", { now, timeZone: "America/New_York" });
    const karachi = getDashboardRangeStart("1d", { now, timeZone: "Asia/Karachi" });
    expect(ny.toISOString()).toBe("2026-07-28T02:00:00.000Z");
    expect(karachi.toISOString()).toBe(ny.toISOString());
  });

  it("today starts earlier than rolling 1d when local midnight is before now−24h", () => {
    // Mid-afternoon EDT: today midnight is ~14h ago; 1d is 24h ago → today is newer
    const afternoonEdt = new Date("2026-07-29T18:00:00.000Z"); // 14:00 EDT
    const today = getDashboardRangeStart("today", {
      now: afternoonEdt,
      timeZone: "America/New_York",
    });
    const rolling = getDashboardRangeStart("1d", {
      now: afternoonEdt,
      timeZone: "America/New_York",
    });
    expect(today.getTime()).toBeGreaterThan(rolling.getTime());
  });
});

describe("filterActivityRecordsByDateRange with today", () => {
  const now = new Date("2026-07-29T02:00:00.000Z");

  function record(id: string, occurredAt: string): ActivityRecord {
    return {
      id,
      userId: "u1",
      channel: "cold_email",
      type: "email_sent",
      occurredAt,
    };
  }

  it("includes events after NY midnight but excludes earlier same UTC day", () => {
    const beforeNyMidnight = record("a", "2026-07-28T03:00:00.000Z"); // still Jul 27 EDT
    const afterNyMidnight = record("b", "2026-07-28T05:00:00.000Z"); // Jul 28 EDT
    const filtered = filterActivityRecordsByDateRange(
      [beforeNyMidnight, afterNyMidnight],
      "today",
      { now, timeZone: "America/New_York" },
    );
    expect(filtered.map((r) => r.id)).toEqual(["b"]);
  });
});
