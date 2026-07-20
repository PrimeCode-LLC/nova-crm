import { describe, expect, it } from "vitest";
import {
  SCHEDULED_SEND_MAX_ATTEMPTS,
  classifyScheduledSendError,
  nextRetryAtIso,
  nextUtcMidnightIso,
  normalizeSendGapSeconds,
  scheduledSendRetryDelayMs,
} from "@/lib/email/scheduled-send-failure";
import { resolveSequenceThreadContext, type SequenceThreadStep } from "@/lib/email/sequence-thread";

describe("classifyScheduledSendError", () => {
  it("classifies quota errors", () => {
    expect(classifyScheduledSendError("Daily send limit reached (50/50).")).toBe("quota");
  });

  it("classifies permanent auth / recipient errors", () => {
    expect(classifyScheduledSendError("Authentication failed")).toBe("permanent");
    expect(classifyScheduledSendError("550 User unknown")).toBe("permanent");
    expect(classifyScheduledSendError("Mailbox no longer exists.")).toBe("permanent");
  });

  it("classifies transient network / 4xx SMTP", () => {
    expect(classifyScheduledSendError("ETIMEDOUT")).toBe("transient");
    expect(classifyScheduledSendError("421 Too many connections")).toBe("transient");
    expect(classifyScheduledSendError("Connection timeout")).toBe("transient");
  });

  it("defaults unknown errors to transient for retry", () => {
    expect(classifyScheduledSendError("weird provider blip")).toBe("transient");
  });

  it("honors kindHint", () => {
    expect(classifyScheduledSendError("anything", "quota")).toBe("quota");
  });
});

describe("scheduledSendRetryDelayMs / nextRetryAtIso", () => {
  it("backs off across attempts", () => {
    expect(scheduledSendRetryDelayMs(1)).toBe(10 * 60_000);
    expect(scheduledSendRetryDelayMs(2)).toBe(60 * 60_000);
    expect(scheduledSendRetryDelayMs(3)).toBe(6 * 60 * 60_000);
  });

  it("produces a future ISO timestamp", () => {
    const now = new Date("2026-07-21T10:00:00.000Z");
    const next = nextRetryAtIso(1, now);
    expect(new Date(next).getTime()).toBe(now.getTime() + 10 * 60_000);
  });

  it("defers quota past UTC midnight", () => {
    const now = new Date("2026-07-21T22:15:00.000Z");
    const next = nextUtcMidnightIso(now);
    expect(new Date(next).getTime()).toBeGreaterThanOrEqual(
      Date.UTC(2026, 6, 22, 0, 0, 0),
    );
  });

  it("caps max attempts constant", () => {
    expect(SCHEDULED_SEND_MAX_ATTEMPTS).toBe(3);
  });
});

describe("normalizeSendGapSeconds", () => {
  it("defaults to 15 when unset", () => {
    expect(normalizeSendGapSeconds(null)).toBe(15);
    expect(normalizeSendGapSeconds(undefined)).toBe(15);
  });

  it("allows zero and clamps to 120", () => {
    expect(normalizeSendGapSeconds(0)).toBe(0);
    expect(normalizeSendGapSeconds(999)).toBe(120);
  });
});

describe("resolveSequenceThreadContext with needs_retry / failed priors", () => {
  const root: SequenceThreadStep = {
    id: "a",
    dueAt: "2026-07-01T10:00:00.000Z",
    deliveryStatus: "sent",
    sentAt: "2026-07-01T10:01:00.000Z",
    sentMessageId: "mid-root",
    emailSubject: "Hello",
  };

  it("waits when a prior step is needs_retry", () => {
    const retrying: SequenceThreadStep = {
      id: "b",
      dueAt: "2026-07-04T10:00:00.000Z",
      deliveryStatus: "needs_retry",
      scheduledEmailId: "sch-1",
    };
    const current: SequenceThreadStep = {
      id: "c",
      dueAt: "2026-07-09T10:00:00.000Z",
      deliveryStatus: "scheduled",
      scheduledEmailId: "sch-2",
    };
    expect(resolveSequenceThreadContext(current, [root, retrying, current]).kind).toBe(
      "wait_for_prior",
    );
  });

  it("continues as root/reply when prior permanently failed", () => {
    const failed: SequenceThreadStep = {
      id: "b",
      dueAt: "2026-07-04T10:00:00.000Z",
      deliveryStatus: "failed",
    };
    const current: SequenceThreadStep = {
      id: "c",
      dueAt: "2026-07-09T10:00:00.000Z",
      deliveryStatus: "scheduled",
      scheduledEmailId: "sch-2",
      emailSubject: "Follow up",
    };
    const resolution = resolveSequenceThreadContext(current, [root, failed, current]);
    expect(resolution.kind).toBe("reply");
    if (resolution.kind === "reply") {
      expect(resolution.inReplyTo).toBe("mid-root");
    }
  });
});
