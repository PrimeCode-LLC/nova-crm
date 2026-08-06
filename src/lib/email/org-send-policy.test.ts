import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_SEND_POLICY,
  isOrgWorkingDay,
  nextOrgWorkingDayKey,
  weekdayKeyFromDayKey,
} from "@/lib/email/org-send-policy";
import { defaultAudienceScheduleDatetimeLocal } from "@/lib/email/audience-schedule";
import { autoFixScheduleDates } from "@/lib/email/mailbox-schedule-capacity";
import { assignProspectSchedule, type MailboxCapacityState } from "@/lib/email/bulk-mailbox-assign";
import { addUtcDayKey, scheduleDayKeyFromDate } from "@/lib/email/mailbox-schedule-capacity";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

const TZ = "America/New_York";

describe("org send policy working days", () => {
  it("treats Sat/Sun as closed under the default policy", () => {
    expect(isOrgWorkingDay("2026-08-07", DEFAULT_ORG_SEND_POLICY, TZ)).toBe(true); // Fri
    expect(isOrgWorkingDay("2026-08-08", DEFAULT_ORG_SEND_POLICY, TZ)).toBe(false); // Sat
    expect(isOrgWorkingDay("2026-08-09", DEFAULT_ORG_SEND_POLICY, TZ)).toBe(false); // Sun
    expect(nextOrgWorkingDayKey("2026-08-08", DEFAULT_ORG_SEND_POLICY, TZ)).toBe("2026-08-10");
  });

  it("maps day keys to weekday names in the org zone", () => {
    expect(weekdayKeyFromDayKey("2026-08-07", TZ)).toBe("friday");
    expect(weekdayKeyFromDayKey("2026-08-10", TZ)).toBe("monday");
  });
});

describe("after-hours placement", () => {
  it("moves Friday 6pm EST to Monday morning inside the send window", () => {
    const now = new Date("2026-08-07T22:00:00.000Z"); // Fri 6pm EDT
    const local = defaultAudienceScheduleDatetimeLocal({
      timeZone: TZ,
      sendWindowStartHour: 9,
      sendWindowEndHour: 12,
      sendPolicy: DEFAULT_ORG_SEND_POLICY,
      now,
    });
    expect(local.startsWith("2026-08-10T")).toBe(true);
    const hour = Number(local.slice(11, 13));
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(12);
  });
});

describe("capacity spill skips weekends", () => {
  it("auto-fix jumps Saturday to Monday when Friday is full", () => {
    const friday = "2026-08-07";
    const saturday = "2026-08-08";
    const monday = "2026-08-10";
    const byDay = {
      [friday]: {
        dayKey: friday,
        sent: 0,
        pending: 1,
        booked: 1,
        limit: 1,
        remaining: 0,
      },
      [saturday]: {
        dayKey: saturday,
        sent: 0,
        pending: 0,
        booked: 0,
        limit: 1,
        remaining: 1,
      },
      [monday]: {
        dayKey: monday,
        sent: 0,
        pending: 0,
        booked: 0,
        limit: 1,
        remaining: 1,
      },
    };
    const satNoon = new Date(`${saturday}T16:00:00.000Z`);
    const result = autoFixScheduleDates(
      [{ id: "s1", scheduledAt: toDatetimeLocalValue(satNoon, TZ), included: true }],
      byDay,
      1,
      14,
      TZ,
      { sendPolicy: DEFAULT_ORG_SEND_POLICY },
    );
    expect(result.unresolvedIds).toEqual([]);
    const placedDay = scheduleDayKeyFromDate(result.steps[0]!.scheduledAt, TZ);
    expect(placedDay).toBe(monday);
  });

  it("does not leave overflow probes outside working hours", () => {
    const zone = TZ;
    const today = "2026-08-05";
    const byDay = {
      [today]: {
        dayKey: today,
        sent: 0,
        pending: 0,
        booked: 0,
        limit: 10,
        remaining: 10,
      },
    };
    const beforeOpen = new Date("2026-08-05T08:30:00.000Z"); // 4:30am EDT
    const result = autoFixScheduleDates(
      [{ id: "s1", scheduledAt: toDatetimeLocalValue(beforeOpen, zone), included: true }],
      byDay,
      10,
      7,
      zone,
      { sendPolicy: DEFAULT_ORG_SEND_POLICY },
    );
    expect(result.unresolvedIds).toEqual([]);
    const local = result.steps[0]!.scheduledAt;
    const hour = Number(local.slice(11, 13));
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(17);
  });

  it("honours an org-wide daily ceiling across mailboxes", () => {
    const today = scheduleDayKeyFromDate(new Date("2026-08-05T15:00:00.000Z"), TZ);
    const byDay: MailboxCapacityState["byDay"] = {};
    for (let i = 0; i < 5; i += 1) {
      const key = addUtcDayKey(today, i);
      byDay[key] = {
        dayKey: key,
        sent: 0,
        pending: 0,
        booked: 0,
        limit: 10,
        remaining: 10,
      };
    }
    const states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 10, byDay: structuredClone(byDay) },
      { mailboxId: "mb-b", limit: 10, byDay: structuredClone(byDay) },
    ];
    const noon = new Date(`${today}T16:00:00.000Z`);
    const scheduledAt = toDatetimeLocalValue(noon, TZ);
    const orgRemainingByDay: Record<string, number> = { [today]: 1 };
    const first = assignProspectSchedule({
      states,
      steps: [{ id: "s1", scheduledAt, included: true }],
      roundRobinIndex: 0,
      timeZone: TZ,
      sendPolicy: DEFAULT_ORG_SEND_POLICY,
      orgCeiling: 1,
      orgRemainingByDay,
    });
    expect(first.ok).toBe(true);
    const second = assignProspectSchedule({
      states: first.ok ? first.nextStates : states,
      steps: [{ id: "s2", scheduledAt, included: true }],
      roundRobinIndex: 1,
      timeZone: TZ,
      sendPolicy: DEFAULT_ORG_SEND_POLICY,
      orgCeiling: 1,
      orgRemainingByDay: first.nextOrgRemainingByDay,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondDay = scheduleDayKeyFromDate(second.steps[0]!.scheduledAt, TZ);
    expect(secondDay > today).toBe(true);
  });

  it("preserves gaps when an earlier step spills past later drafts", () => {
    const zone = TZ;
    // autoFix uses Date.now() for todayKey — fill the next 10 working-capable days.
    const today = scheduleDayKeyFromDate(new Date(), zone);
    const byDay: Record<
      string,
      {
        dayKey: string;
        sent: number;
        pending: number;
        booked: number;
        limit: number;
        remaining: number;
      }
    > = {};
    for (let i = 0; i < 30; i += 1) {
      const key = addUtcDayKey(today, i);
      const full = i < 10;
      byDay[key] = {
        dayKey: key,
        sent: 0,
        pending: full ? 1 : 0,
        booked: full ? 1 : 0,
        limit: 1,
        remaining: full ? 0 : 1,
      };
    }
    const firstDay = today;
    const secondDay = addUtcDayKey(today, 3);
    const firstAt = toDatetimeLocalValue(new Date(`${firstDay}T13:00:00.000Z`), zone);
    const secondAt = toDatetimeLocalValue(new Date(`${secondDay}T13:00:00.000Z`), zone);
    const result = autoFixScheduleDates(
      [
        { id: "s1", scheduledAt: firstAt, included: true },
        { id: "s2", scheduledAt: secondAt, included: true },
      ],
      byDay,
      1,
      40,
      zone,
      { sendPolicy: DEFAULT_ORG_SEND_POLICY },
    );
    expect(result.unresolvedIds).toEqual([]);
    const d1 = scheduleDayKeyFromDate(result.steps[0]!.scheduledAt, zone);
    const d2 = scheduleDayKeyFromDate(result.steps[1]!.scheduledAt, zone);
    expect(d1 >= addUtcDayKey(today, 10)).toBe(true);
    // Must not collapse s2 onto the same day as spilled s1 (+60s bug).
    expect(d2 > d1).toBe(true);
    const gapDays =
      (Date.parse(`${d2}T12:00:00.000Z`) - Date.parse(`${d1}T12:00:00.000Z`)) /
      (24 * 60 * 60 * 1000);
    expect(gapDays).toBeGreaterThanOrEqual(3);
  });
});
