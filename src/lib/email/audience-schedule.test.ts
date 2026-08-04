import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_WINDOW_END_HOUR,
  DEFAULT_SEND_WINDOW_START_HOUR,
  defaultAudienceScheduleDatetimeLocal,
  normalizeSendWindow,
  resolveScheduleTimezone,
} from "@/lib/email/audience-schedule";
import { zonedDayKey } from "@/lib/org-timezone";

describe("resolveScheduleTimezone", () => {
  it("prefers valid audience timezone over org", () => {
    expect(resolveScheduleTimezone("Australia/Sydney", "America/New_York")).toBe(
      "Australia/Sydney",
    );
  });

  it("falls back to org when audience unset or invalid", () => {
    expect(resolveScheduleTimezone(undefined, "America/New_York")).toBe("America/New_York");
    expect(resolveScheduleTimezone("Not/AZone", "America/New_York")).toBe("America/New_York");
  });
});

describe("normalizeSendWindow", () => {
  it("defaults to 9–12", () => {
    expect(normalizeSendWindow()).toEqual({
      startHour: DEFAULT_SEND_WINDOW_START_HOUR,
      endHour: DEFAULT_SEND_WINDOW_END_HOUR,
    });
  });

  it("repairs inverted windows", () => {
    expect(normalizeSendWindow(14, 10)).toEqual({ startHour: 14, endHour: 15 });
  });
});

describe("defaultAudienceScheduleDatetimeLocal", () => {
  it("snaps a future due-noon to the send window start in audience TZ", () => {
    // Jul 22 00:00 UTC = Jul 22 10:00 Sydney — prefer a later due day
    const now = new Date("2026-07-21T14:00:00.000Z");
    const preferIso = "2026-07-23T02:00:00.000Z"; // Jul 23 noon Sydney (AEST UTC+10)
    const local = defaultAudienceScheduleDatetimeLocal({
      preferIso,
      timeZone: "Australia/Sydney",
      sendWindowStartHour: 9,
      sendWindowEndHour: 12,
      now,
    });
    expect(local).toBe("2026-07-23T09:00");
  });

  it("skips today's closed window and picks tomorrow morning", () => {
    // 4pm Sydney Jul 22
    const now = new Date("2026-07-22T06:00:00.000Z");
    expect(zonedDayKey(now, "Australia/Sydney")).toBe("2026-07-22");
    const local = defaultAudienceScheduleDatetimeLocal({
      timeZone: "Australia/Sydney",
      sendWindowStartHour: 9,
      sendWindowEndHour: 12,
      now,
    });
    expect(local).toBe("2026-07-23T09:00");
  });

  it("uses now+1m when already inside today's window", () => {
    // 10:00 Sydney Jul 22
    const now = new Date("2026-07-22T00:00:00.000Z");
    const local = defaultAudienceScheduleDatetimeLocal({
      timeZone: "Australia/Sydney",
      sendWindowStartHour: 9,
      sendWindowEndHour: 12,
      now,
    });
    expect(local).toBe("2026-07-22T10:01");
  });
});
