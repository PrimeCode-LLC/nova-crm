import { describe, expect, it } from "vitest";
import { isScheduledDocDue } from "@/lib/email/scheduled-due";
import {
  isAwaitingOutboundSend,
  resolveSequenceThreadContext,
  SEQUENCE_WAIT_FOR_PRIOR_MAX_MS,
} from "@/lib/email/sequence-thread";

describe("isScheduledDocDue", () => {
  const nowMs = Date.parse("2026-09-10T12:00:00.000Z");

  it("is due when scheduledAt has elapsed and notBeforeAt is absent", () => {
    expect(
      isScheduledDocDue({ scheduledAt: "2026-09-10T11:59:00.000Z" }, nowMs),
    ).toBe(true);
  });

  it("is not due when scheduledAt is in the future", () => {
    expect(
      isScheduledDocDue({ scheduledAt: "2026-09-10T12:01:00.000Z" }, nowMs),
    ).toBe(false);
  });

  it("is not due when notBeforeAt is still in the future (send-gap deferral)", () => {
    expect(
      isScheduledDocDue(
        {
          scheduledAt: "2026-09-09T16:44:00.000Z",
          notBeforeAt: "2026-09-10T12:00:15.000Z",
        },
        nowMs,
      ),
    ).toBe(false);
  });

  it("is due when notBeforeAt has elapsed", () => {
    expect(
      isScheduledDocDue(
        {
          scheduledAt: "2026-09-09T16:44:00.000Z",
          notBeforeAt: "2026-09-10T11:59:50.000Z",
        },
        nowMs,
      ),
    ).toBe(true);
  });
});

describe("wait_for_prior stale / blockedBy", () => {
  it("exposes blockedBy on wait_for_prior", () => {
    const nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    const result = resolveSequenceThreadContext(
      {
        id: "f2",
        dueAt: "2026-09-10T11:50:00.000Z",
        deliveryStatus: "scheduled",
        scheduledEmailId: "sch-2",
      },
      [
        {
          id: "f1",
          dueAt: "2026-09-10T11:45:00.000Z",
          emailScheduledAt: "2026-09-10T11:45:00.000Z",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-1",
        },
        {
          id: "f2",
          dueAt: "2026-09-10T11:50:00.000Z",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-2",
        },
      ],
      undefined,
      { nowMs },
    );
    expect(result).toEqual({
      kind: "wait_for_prior",
      blockedBy: { followupId: "f1", deliveryStatus: "scheduled" },
    });
  });

  it("isAwaitingOutboundSend returns false when schedule is older than max wait", () => {
    const nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    expect(
      isAwaitingOutboundSend(
        {
          id: "f1",
          dueAt: "2026-09-10T11:00:00.000Z",
          emailScheduledAt: "2026-09-10T11:00:00.000Z",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-1",
        },
        { nowMs, maxWaitMs: SEQUENCE_WAIT_FOR_PRIOR_MAX_MS },
      ),
    ).toBe(false);
  });

  it("isAwaitingOutboundSend returns true for a freshly scheduled prior", () => {
    const nowMs = Date.parse("2026-09-10T12:00:00.000Z");
    expect(
      isAwaitingOutboundSend(
        {
          id: "f1",
          dueAt: "2026-09-10T11:55:00.000Z",
          emailScheduledAt: "2026-09-10T11:55:00.000Z",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-1",
        },
        { nowMs, maxWaitMs: SEQUENCE_WAIT_FOR_PRIOR_MAX_MS },
      ),
    ).toBe(true);
  });
});
