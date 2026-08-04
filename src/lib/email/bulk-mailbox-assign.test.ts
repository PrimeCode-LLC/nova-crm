import { describe, expect, it } from "vitest";
import {
  assignProspectSchedule,
  consumeCapacityForSteps,
  pickMailboxForProspect,
  remainingOnDay,
  type MailboxCapacityState,
} from "@/lib/email/bulk-mailbox-assign";
import { scheduleDayKeyFromDate } from "@/lib/email/mailbox-schedule-capacity";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

const TZ = "UTC";

function dayState(
  dayKey: string,
  limit: number,
  booked: number,
): Record<string, MailboxCapacityState["byDay"][string]> {
  return {
    [dayKey]: {
      dayKey,
      sent: 0,
      pending: booked,
      booked,
      limit,
      remaining: Math.max(0, limit - booked),
    },
  };
}

function fillHorizon(
  fromDayKey: string,
  days: number,
  limit: number,
  bookedToday = 0,
): Record<string, MailboxCapacityState["byDay"][string]> {
  const byDay: Record<string, MailboxCapacityState["byDay"][string]> = {};
  const start = new Date(`${fromDayKey}T00:00:00.000Z`);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dayKey = d.toISOString().slice(0, 10);
    const booked = i === 0 ? bookedToday : 0;
    byDay[dayKey] = {
      dayKey,
      sent: 0,
      pending: booked,
      booked,
      limit,
      remaining: Math.max(0, limit - booked),
    };
  }
  return byDay;
}

describe("bulk mailbox assign", () => {
  it("picks the mailbox with most remaining on the preferred day", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 5, byDay: dayState(today, 5, 4) },
      { mailboxId: "mb-b", limit: 5, byDay: dayState(today, 5, 1) },
    ];
    const picked = pickMailboxForProspect({
      states,
      preferredDayKey: today,
      roundRobinIndex: 0,
    });
    expect(picked?.state.mailboxId).toBe("mb-b");
  });

  it("round-robins among equal remaining capacity", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 10, byDay: dayState(today, 10, 0) },
      { mailboxId: "mb-b", limit: 10, byDay: dayState(today, 10, 0) },
    ];
    const first = pickMailboxForProspect({
      states,
      preferredDayKey: today,
      roundRobinIndex: 0,
    });
    const second = pickMailboxForProspect({
      states,
      preferredDayKey: today,
      roundRobinIndex: 1,
    });
    expect(first?.state.mailboxId).toBe("mb-a");
    expect(second?.state.mailboxId).toBe("mb-b");
  });

  it("consumes capacity so later prospects see earlier bookings", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const state: MailboxCapacityState = {
      mailboxId: "mb-a",
      limit: 2,
      byDay: dayState(today, 2, 0),
    };
    const at = toDatetimeLocalValue(new Date(`${today}T15:00:00.000Z`), TZ);
    const next = consumeCapacityForSteps(
      state,
      [
        { id: "s1", scheduledAt: at, included: true },
        { id: "s2", scheduledAt: at, included: true },
      ],
      TZ,
    );
    expect(remainingOnDay(next, today)).toBe(0);
  });

  it("packs multiple prospects across mailboxes and auto-fixes over-limit days", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const byDay = fillHorizon(today, 10, 1, 0);
    let states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 1, byDay: structuredClone(byDay) },
      { mailboxId: "mb-b", limit: 1, byDay: structuredClone(byDay) },
    ];

    const noon = new Date(`${today}T12:00:00.000Z`);
    const scheduledAt = toDatetimeLocalValue(noon, TZ);

    let rr = 0;
    const mailboxIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = assignProspectSchedule({
        states,
        steps: [{ id: `p${i}`, scheduledAt, included: true }],
        roundRobinIndex: rr,
        timeZone: TZ,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      mailboxIds.push(result.mailboxId);
      states = result.nextStates;
      rr = result.nextRoundRobinIndex;
    }

    // Capacity of 1/day on two mailboxes → both mailboxes used across the four prospects.
    expect(new Set(mailboxIds)).toEqual(new Set(["mb-a", "mb-b"]));
    expect(mailboxIds).toHaveLength(4);
  });

  it("fails when steps cannot fit within the horizon", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const byDay = fillHorizon(today, 3, 1, 1);
    // Fill all 3 days completely
    for (const row of Object.values(byDay)) {
      row.booked = 1;
      row.pending = 1;
      row.remaining = 0;
    }
    const states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 1, byDay },
    ];
    const noon = new Date(`${today}T12:00:00.000Z`);
    const result = assignProspectSchedule({
      states,
      steps: [{ id: "s1", scheduledAt: toDatetimeLocalValue(noon, TZ), included: true }],
      roundRobinIndex: 0,
      horizonDays: 3,
      timeZone: TZ,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolvedIds).toContain("s1");
  });

  it("restricts picks to candidateMailboxIds while updating full capacity", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const byDay = fillHorizon(today, 5, 5, 0);
    let states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 5, byDay: structuredClone(byDay) },
      { mailboxId: "mb-b", limit: 5, byDay: structuredClone(byDay) },
    ];
    const noon = new Date(`${today}T12:00:00.000Z`);
    const scheduledAt = toDatetimeLocalValue(noon, TZ);

    const result = assignProspectSchedule({
      states,
      steps: [{ id: "s1", scheduledAt, included: true }],
      roundRobinIndex: 0,
      timeZone: TZ,
      candidateMailboxIds: ["mb-b"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mailboxId).toBe("mb-b");
    expect(remainingOnDay(result.nextStates[0]!, today)).toBe(5);
    expect(remainingOnDay(result.nextStates[1]!, today)).toBe(4);
    states = result.nextStates;
  });

  it("fails when candidateMailboxIds match no states", () => {
    const today = scheduleDayKeyFromDate(new Date(), TZ);
    const states: MailboxCapacityState[] = [
      { mailboxId: "mb-a", limit: 5, byDay: dayState(today, 5, 0) },
    ];
    const noon = new Date(`${today}T12:00:00.000Z`);
    const result = assignProspectSchedule({
      states,
      steps: [{ id: "s1", scheduledAt: toDatetimeLocalValue(noon, TZ), included: true }],
      roundRobinIndex: 0,
      timeZone: TZ,
      candidateMailboxIds: ["mb-missing"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No eligible mailboxes/);
  });
});
