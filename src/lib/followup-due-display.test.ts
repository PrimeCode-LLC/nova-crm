import { describe, expect, it } from "vitest";
import {
  dueAtForReschedulePreset,
  followupDisplayTitle,
  followupSendState,
  formatFollowupDueLabel,
  formatFollowupQueuedLabel,
  isFollowupQueuedForSend,
  isFollowupRetryable,
  nextWeekdayYmd,
  normalizeFollowupTitle,
  planFollowupTryNow,
  resolveFollowupOwnerId,
  shouldOfferFollowupTryNow,
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

describe("followupSendState", () => {
  const now = new Date("2026-08-04T14:00:00.000Z").getTime();

  it("reports none when no email is linked", () => {
    expect(followupSendState({}, now)).toBe("none");
    // A stale id without a scheduled status is not in flight.
    expect(followupSendState({ scheduledEmailId: "s1" }, now)).toBe("none");
  });

  it("separates a future send from one waiting on the send gap", () => {
    expect(
      followupSendState(
        {
          scheduledEmailId: "s1",
          deliveryStatus: "scheduled",
          emailScheduledAt: "2026-08-04T14:30:00.000Z",
        },
        now,
      ),
    ).toBe("queued");
    expect(
      followupSendState(
        {
          scheduledEmailId: "s1",
          deliveryStatus: "scheduled",
          emailScheduledAt: "2026-08-04T13:00:00.000Z",
        },
        now,
      ),
    ).toBe("queued_late");
  });

  it("prefers failure states over queued", () => {
    expect(
      followupSendState({ scheduledEmailId: "s1", deliveryStatus: "failed" }, now),
    ).toBe("failed");
    expect(
      followupSendState({ scheduledEmailId: "s1", deliveryStatus: "needs_retry" }, now),
    ).toBe("retrying");
    expect(
      isFollowupQueuedForSend({ scheduledEmailId: "s1", deliveryStatus: "failed" }, now),
    ).toBe(false);
  });
});

describe("formatFollowupQueuedLabel", () => {
  const tz = "America/New_York";
  const now = new Date("2026-08-04T14:00:00.000Z");

  it("shows the upcoming send time when still ahead", () => {
    const label = formatFollowupQueuedLabel(
      "2026-08-04T14:30:00.000Z",
      "queued",
      tz,
      { now },
    );
    expect(label).toMatch(/^Sends 10:30\s?AM/i);
  });

  it("never reads as a stalled task once the send time passes", () => {
    const label = formatFollowupQueuedLabel(
      "2026-08-04T12:30:00.000Z",
      "queued_late",
      tz,
      { now },
    );
    expect(label).toBe("In send queue · waiting 1h 30m");
    expect(label).not.toMatch(/ago/);
  });
});

describe("planFollowupTryNow", () => {
  it("retries failed linked sends", () => {
    expect(
      planFollowupTryNow(
        {
          id: "f1",
          title: "Email",
          dueAt: "2026-08-01T12:00:00.000Z",
          ownerId: "u1",
          priority: "high",
          auto: true,
          deliveryStatus: "failed",
          scheduledEmailId: "s1",
          messageBody: "Hi",
        },
        "cold_email",
      ),
    ).toEqual({ kind: "retry" });
  });

  it("schedules email-ready steps ASAP", () => {
    expect(
      planFollowupTryNow(
        {
          id: "f1",
          title: "Email",
          dueAt: "2026-08-01T12:00:00.000Z",
          ownerId: "u1",
          priority: "high",
          auto: true,
          messageBody: "Hi there",
          emailSubject: "Hello",
          channel: "cold_email",
        },
        "cold_email",
      ),
    ).toEqual({ kind: "schedule", requeue: false });
  });

  it("bumps due for reminder-only channels", () => {
    expect(
      planFollowupTryNow(
        {
          id: "f1",
          title: "LinkedIn",
          dueAt: "2026-08-01T12:00:00.000Z",
          ownerId: "u1",
          priority: "medium",
          auto: true,
          messageBody: "Connect note",
          channel: "linkedin_outbound",
        },
        "linkedin_outbound",
      ),
    ).toEqual({ kind: "bump_due" });
  });
});

describe("followupDisplayTitle", () => {
  it("falls back to subject then channel cue", () => {
    expect(followupDisplayTitle({ title: "  ", emailSubject: "Hello" })).toBe("Hello");
    expect(followupDisplayTitle({ title: "", channel: "linkedin_outbound" })).toBe(
      "LinkedIn step",
    );
    expect(followupDisplayTitle({ title: "" })).toBe("Untitled followup");
  });
});

describe("normalizeFollowupTitle / resolveFollowupOwnerId", () => {
  it("never persists a blank title", () => {
    expect(normalizeFollowupTitle({ title: "  ", stepIndex: 0 })).toBe("Follow-up 1");
    expect(
      normalizeFollowupTitle({
        title: "",
        emailSubject: "Intro",
        channel: "cold_email",
      }),
    ).toBe("Intro");
  });

  it("does not treat empty ownerId as assigned", () => {
    expect(resolveFollowupOwnerId("", "actor")).toBe("actor");
    expect(resolveFollowupOwnerId("  ", "actor")).toBe("actor");
    expect(resolveFollowupOwnerId("lead-owner", "actor")).toBe("lead-owner");
  });
});

describe("shouldOfferFollowupTryNow", () => {
  it("hides Try now when nothing can be sent", () => {
    expect(
      shouldOfferFollowupTryNow(
        {
          id: "f1",
          title: "",
          dueAt: "2026-08-01T12:00:00.000Z",
          ownerId: "",
          priority: "medium",
          auto: false,
        },
        "today",
        "cold_email",
      ),
    ).toBe(false);
  });

  it("shows Try now for email-ready due-today steps", () => {
    expect(
      shouldOfferFollowupTryNow(
        {
          id: "f1",
          title: "Email 1",
          dueAt: "2026-08-01T12:00:00.000Z",
          ownerId: "u1",
          priority: "high",
          auto: true,
          messageBody: "Hi",
          emailSubject: "Hello",
          channel: "cold_email",
        },
        "today",
        "cold_email",
      ),
    ).toBe(true);
  });
});
