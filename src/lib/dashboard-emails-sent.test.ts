import { describe, expect, it } from "vitest";
import {
  composeEmailSentAtsFromTimeline,
  countEmailsSentInRange,
  isComposeEmailSentTimelineEvent,
} from "@/lib/dashboard-emails-sent";
import type { Followup, TimelineEvent } from "@/lib/types";

function followup(partial: Partial<Followup> & Pick<Followup, "id">): Followup {
  return {
    leadId: "ld-1",
    ownerId: "u-1",
    dueAt: "2026-09-01T00:00:00.000Z",
    title: "Step",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  } as Followup;
}

function timeline(
  partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "type" | "createdAt">,
): TimelineEvent {
  return {
    leadId: "ld-1",
    summary: "Email sent",
    ...partial,
  };
}

describe("dashboard emails sent helpers", () => {
  it("counts followup sends in range", () => {
    const start = Date.parse("2026-09-01T00:00:00.000Z");
    expect(
      countEmailsSentInRange({
        rangeStart: start,
        followups: [
          followup({
            id: "f1",
            deliveryStatus: "sent",
            sentAt: "2026-09-05T12:00:00.000Z",
          }),
          followup({
            id: "f2",
            deliveryStatus: "sent",
            sentAt: "2026-08-01T12:00:00.000Z",
          }),
          followup({ id: "f3", deliveryStatus: "scheduled" }),
        ],
      }),
    ).toBe(1);
  });

  it("adds compose extras without double-counting sequence timeline rows", () => {
    const start = Date.parse("2026-09-01T00:00:00.000Z");
    const compose = timeline({
      id: "te-1",
      type: "email_sent",
      createdAt: "2026-09-10T12:00:00.000Z",
      payload: { source: "smtp_send" },
    });
    const sequence = timeline({
      id: "te-2",
      type: "email_sent",
      createdAt: "2026-09-10T13:00:00.000Z",
      payload: { followupId: "f-1", source: "scheduled" },
    });

    expect(isComposeEmailSentTimelineEvent(compose)).toBe(true);
    expect(isComposeEmailSentTimelineEvent(sequence)).toBe(false);

    expect(
      countEmailsSentInRange({
        rangeStart: start,
        followups: [
          followup({
            id: "f-1",
            deliveryStatus: "sent",
            sentAt: "2026-09-10T13:00:00.000Z",
          }),
        ],
        extraSentAts: composeEmailSentAtsFromTimeline([compose, sequence]),
      }),
    ).toBe(2);
  });
});
