import { describe, expect, it } from "vitest";
import {
  datetimeLocalInZone,
  endOfZonedDay,
  formatInstantInZone,
  isoFromDateInputInZone,
  isoFromDatetimeLocalInZone,
  isValidIanaTimezone,
  resolveOrgTimezone,
  startOfZonedDay,
  zonedDayKey,
} from "@/lib/org-timezone";
import { isFollowupOverdue } from "@/lib/followup-open-status";
import type { Followup } from "@/lib/types";

function followup(partial: Partial<Followup> & Pick<Followup, "id" | "dueAt">): Followup {
  return {
    title: partial.title ?? "Step",
    ownerId: partial.ownerId ?? "u1",
    priority: partial.priority ?? "medium",
    auto: partial.auto ?? false,
    ...partial,
  };
}

describe("isValidIanaTimezone", () => {
  it("accepts known IANA zones and rejects junk", () => {
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("Asia/Karachi")).toBe(true);
    expect(isValidIanaTimezone("Not/AZone")).toBe(false);
    expect(isValidIanaTimezone("")).toBe(false);
  });
});

describe("resolveOrgTimezone", () => {
  it("prefers sticky org timezone over fallback", () => {
    expect(resolveOrgTimezone("America/New_York", { fallback: "Asia/Karachi" })).toBe(
      "America/New_York",
    );
  });

  it("uses fallback when org timezone empty", () => {
    expect(resolveOrgTimezone("", { fallback: "Asia/Karachi" })).toBe("Asia/Karachi");
    expect(resolveOrgTimezone(undefined, { fallback: "UTC" })).toBe("UTC");
  });
});

describe("zoned day boundaries EST vs Karachi", () => {
  // 2026-07-29 02:00 UTC = Jul 28 evening EDT, Jul 29 morning PKT
  const utcInstant = new Date("2026-07-29T02:00:00.000Z");

  it("maps the same UTC instant to different calendar days", () => {
    expect(zonedDayKey(utcInstant, "America/New_York")).toBe("2026-07-28");
    expect(zonedDayKey(utcInstant, "Asia/Karachi")).toBe("2026-07-29");
  });

  it("start/end of day stay inside the zoned calendar day", () => {
    const startNy = startOfZonedDay(utcInstant, "America/New_York");
    const endNy = endOfZonedDay(utcInstant, "America/New_York");
    expect(zonedDayKey(startNy, "America/New_York")).toBe("2026-07-28");
    expect(zonedDayKey(endNy, "America/New_York")).toBe("2026-07-28");
    expect(startNy.getTime()).toBeLessThan(utcInstant.getTime());
    expect(endNy.getTime()).toBeGreaterThan(utcInstant.getTime());
  });

  it("isoFromDateInputInZone stores noon in the given zone", () => {
    const iso = isoFromDateInputInZone("2026-07-29", "America/New_York");
    const d = new Date(iso);
    expect(zonedDayKey(d, "America/New_York")).toBe("2026-07-29");
    // Noon EDT = 16:00 UTC in July
    expect(d.toISOString()).toBe("2026-07-29T16:00:00.000Z");
  });

  it("datetime-local wall clock is interpreted in org zone", () => {
    const iso = isoFromDatetimeLocalInZone("2026-07-29T09:00", "America/New_York");
    expect(new Date(iso).toISOString()).toBe("2026-07-29T13:00:00.000Z"); // EDT = UTC-4
    expect(datetimeLocalInZone(iso, "America/New_York")).toBe("2026-07-29T09:00");
  });

  it("formats naive datetime-local as org wall clock, not the browser zone", () => {
    const label = formatInstantInZone("2026-08-05T09:08", "America/New_York");
    expect(label).toMatch(/9:08\sAM/);
    expect(label).not.toMatch(/12:08\sAM/);
  });
});

describe("isFollowupOverdue with org timezone", () => {
  it("uses EST start-of-day even when 'now' is afternoon in Pakistan", () => {
    // Pakistan afternoon Jul 29 ≈ still morning Jul 29 EDT... pick a time where
    // Karachi is already Jul 30 but New York is still Jul 29.
    // 2026-07-29 20:00 UTC = Jul 30 01:00 PKT, Jul 29 16:00 EDT
    const now = new Date("2026-07-29T20:00:00.000Z");
    const dueTodayEst = isoFromDateInputInZone("2026-07-29", "America/New_York");
    const dueYesterdayEst = isoFromDateInputInZone("2026-07-28", "America/New_York");

    expect(
      isFollowupOverdue(followup({ id: "1", dueAt: dueTodayEst }), {
        now,
        timeZone: "America/New_York",
      }),
    ).toBe(false);

    expect(
      isFollowupOverdue(followup({ id: "2", dueAt: dueYesterdayEst }), {
        now,
        timeZone: "America/New_York",
      }),
    ).toBe(true);

    // Same dueTodayEst would be "yesterday" if we wrongly used Karachi
    expect(
      isFollowupOverdue(followup({ id: "3", dueAt: dueTodayEst }), {
        now,
        timeZone: "Asia/Karachi",
      }),
    ).toBe(true);
  });
});
