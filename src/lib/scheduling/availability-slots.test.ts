import { describe, expect, it } from "vitest";

import { datesWithAvailability, generateSlotsForDate } from "@/lib/scheduling/availability-slots";
import { DEFAULT_WEEKLY_AVAILABILITY } from "@/lib/scheduling/defaults";
import type { AvailabilitySchedule } from "@/lib/types";

function schedule(timezone: string): AvailabilitySchedule {
  return {
    id: "s", organizationId: "o", ownerUid: "h", name: "Hours", isDefault: true, timezone,
    weekly: DEFAULT_WEEKLY_AVAILABILITY, minNoticeHours: 4, maxDaysAhead: 14,
    createdAt: "", updatedAt: "",
  };
}

const link = { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 15, existingMeetings: [] };
const longAgo = new Date("2026-01-01T00:00:00Z");

describe("availability in the schedule's timezone (QA 2.3)", () => {
  it("09:00 in the schedule zone, whatever the server zone", () => {
    const ny = generateSlotsForDate({ ...link, dateYmd: "2026-10-26", schedule: schedule("America/New_York"), now: longAgo });
    expect(ny[0]?.startAt).toBe("2026-10-26T13:00:00.000Z"); // EDT (UTC-4)
    const pk = generateSlotsForDate({ ...link, dateYmd: "2026-10-26", schedule: schedule("Asia/Karachi"), now: longAgo });
    expect(pk[0]?.startAt).toBe("2026-10-26T04:00:00.000Z"); // PKT (UTC+5)
    expect(pk.at(-1)?.endAt).toBe("2026-10-26T11:15:00.000Z"); // 45-min steps: last slot 15:45-16:15 PKT
  });

  it("follows daylight-saving changes", () => {
    const after = generateSlotsForDate({ ...link, dateYmd: "2026-11-02", schedule: schedule("America/New_York"), now: longAgo });
    expect(after[0]?.startAt).toBe("2026-11-02T14:00:00.000Z"); // EST (UTC-5)
  });

  it("weekends have no slots", () => {
    expect(generateSlotsForDate({ ...link, dateYmd: "2026-10-25", schedule: schedule("Asia/Karachi"), now: longAgo })).toEqual([]);
  });

  it("offered dates are the schedule zone's calendar days (SCH-02: 00:25 PKT on Wed 21 Oct)", () => {
    const now = new Date("2026-10-20T19:25:00Z"); // 00:25 PKT Wednesday
    const dates = datesWithAvailability({ ...link, schedule: schedule("Asia/Karachi"), now });
    expect(dates[0]).toBe("2026-10-21"); // never the past day (Tue 20)
    expect(dates).toContain("2026-10-23"); // Friday offered
    expect(dates).not.toContain("2026-10-25"); // Sunday not offered
    expect(dates).toContain("2026-10-26"); // Monday offered
  });
});
