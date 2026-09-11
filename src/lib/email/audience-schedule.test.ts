import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_WINDOW_END_HOUR,
  DEFAULT_SEND_WINDOW_START_HOUR,
  defaultAudienceScheduleDatetimeLocal,
  normalizeSendWindow,
  resolveScheduleTimezone,
} from "@/lib/email/audience-schedule";
import { zonedDayKey } from "@/lib/org-timezone";
import { DEFAULT_ORG_SEND_POLICY } from "@/lib/email/org-send-policy";

describe("resolveScheduleTimezone", () => {
  it("prefers recipient, then audience, then org timezone", () => {
    expect(
      resolveScheduleTimezone("Australia/Sydney", "America/New_York", "Europe/London"),
    ).toBe("Europe/London");
    expect(resolveScheduleTimezone("Australia/Sydney", "America/New_York")).toBe(
      "Australia/Sydney",
    );
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

  it("skips weekend days when org send policy is applied", () => {
    const now = new Date("2026-08-07T22:30:00.000Z"); // Friday 6:30pm EDT
    const local = defaultAudienceScheduleDatetimeLocal({
      timeZone: "America/New_York",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
      sendPolicy: DEFAULT_ORG_SEND_POLICY,
      now,
    });
    expect(local.startsWith("2026-08-10T")).toBe(true);
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

describe("defaultAudienceScheduleDatetimeLocal spread", () => {
  const baseInput = {
    preferIso: "2026-07-23T02:00:00.000Z",
    timeZone: "Australia/Sydney",
    sendWindowStartHour: 9,
    sendWindowEndHour: 12,
    now: new Date("2026-07-21T14:00:00.000Z"),
  };

  function minutesFromLocal(local: string): number {
    const [, timePart = "00:00"] = local.split("T");
    const [h, m] = timePart.split(":");
    return Number(h) * 60 + Number(m);
  }

  it("is deterministic for the same key", () => {
    const a = defaultAudienceScheduleDatetimeLocal({ ...baseInput, spreadKey: "f-1" });
    const b = defaultAudienceScheduleDatetimeLocal({ ...baseInput, spreadKey: "f-1" });
    expect(a).toBe(b);
  });

  it("keeps every spread slot inside the window", () => {
    const start = 9 * 60;
    const end = 12 * 60;
    for (let i = 0; i < 200; i += 1) {
      const local = defaultAudienceScheduleDatetimeLocal({
        ...baseInput,
        spreadKey: `f-${i}`,
      });
      expect(local.startsWith("2026-07-23T")).toBe(true);
      const minutes = minutesFromLocal(local);
      expect(minutes).toBeGreaterThanOrEqual(start);
      expect(minutes).toBeLessThanOrEqual(end);
    }
  });

  it("spreads a batch across many distinct minutes instead of one instant", () => {
    const slots = new Set(
      Array.from({ length: 200 }, (_, i) =>
        defaultAudienceScheduleDatetimeLocal({ ...baseInput, spreadKey: `f-${i}` }),
      ),
    );
    // Without spreading this collapses to a single 09:00 timestamp.
    expect(slots.size).toBeGreaterThan(50);
  });

  it("still honours the earliest-allowed time when today's window is partly past", () => {
    // 10:00 Sydney — spread offsets before 10:01 must clamp forward, not go backwards.
    const local = defaultAudienceScheduleDatetimeLocal({
      timeZone: "Australia/Sydney",
      sendWindowStartHour: 9,
      sendWindowEndHour: 12,
      now: new Date("2026-07-22T00:00:00.000Z"),
      spreadKey: "f-1",
    });
    expect(minutesFromLocal(local)).toBeGreaterThanOrEqual(10 * 60 + 1);
  });
});
