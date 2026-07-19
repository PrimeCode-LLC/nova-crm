import { describe, expect, it } from "vitest";
import { resolveSequenceThreadContext } from "@/lib/email/sequence-thread";

describe("resolveSequenceThreadContext", () => {
  it("treats the earliest due step as the thread root", () => {
    const result = resolveSequenceThreadContext(
      { id: "f1", dueAt: "2026-01-01T10:00:00.000Z", title: "Intro" },
      [
        { id: "f1", dueAt: "2026-01-01T10:00:00.000Z", title: "Intro" },
        {
          id: "f2",
          dueAt: "2026-01-03T10:00:00.000Z",
          title: "Follow-up",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-2",
        },
      ],
    );
    expect(result).toEqual({ kind: "root" });
  });

  it("waits when an earlier step is still queued to send", () => {
    const result = resolveSequenceThreadContext(
      {
        id: "f2",
        dueAt: "2026-01-03T10:00:00.000Z",
        title: "Follow-up",
        deliveryStatus: "scheduled",
        scheduledEmailId: "sch-2",
      },
      [
        {
          id: "f1",
          dueAt: "2026-01-01T10:00:00.000Z",
          title: "Intro",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-1",
        },
        {
          id: "f2",
          dueAt: "2026-01-03T10:00:00.000Z",
          title: "Follow-up",
          deliveryStatus: "scheduled",
          scheduledEmailId: "sch-2",
        },
      ],
    );
    expect(result).toEqual({ kind: "wait_for_prior" });
  });

  it("replies to the latest prior Message-ID and uses Re: of the root subject", () => {
    const result = resolveSequenceThreadContext(
      {
        id: "f3",
        dueAt: "2026-01-07T10:00:00.000Z",
        title: "Third touch",
        emailSubject: "Totally different subject",
      },
      [
        {
          id: "f1",
          dueAt: "2026-01-01T10:00:00.000Z",
          emailSubject: "Quick question about Acme",
          deliveryStatus: "sent",
          sentAt: "2026-01-01T10:05:00.000Z",
          sentMessageId: "root@nova.local",
        },
        {
          id: "f2",
          dueAt: "2026-01-03T10:00:00.000Z",
          emailSubject: "Checking in",
          deliveryStatus: "sent",
          sentAt: "2026-01-03T10:05:00.000Z",
          sentMessageId: "second@nova.local",
        },
        {
          id: "f3",
          dueAt: "2026-01-07T10:00:00.000Z",
          title: "Third touch",
        },
      ],
    );
    expect(result).toEqual({
      kind: "reply",
      inReplyTo: "second@nova.local",
      referenceIds: ["root@nova.local", "second@nova.local"],
      subject: "Re: Quick question about Acme",
    });
  });

  it("skips cancelled earlier steps and still threads to sent ones", () => {
    const result = resolveSequenceThreadContext(
      { id: "f3", dueAt: "2026-01-07T10:00:00.000Z", title: "Later" },
      [
        {
          id: "f1",
          dueAt: "2026-01-01T10:00:00.000Z",
          title: "Intro",
          deliveryStatus: "sent",
          sentMessageId: "<root@nova.local>",
          sentAt: "2026-01-01T10:05:00.000Z",
        },
        {
          id: "f2",
          dueAt: "2026-01-03T10:00:00.000Z",
          title: "Skipped",
          deliveryStatus: "cancelled",
          scheduledEmailId: "sch-2",
        },
        { id: "f3", dueAt: "2026-01-07T10:00:00.000Z", title: "Later" },
      ],
    );
    expect(result).toEqual({
      kind: "reply",
      inReplyTo: "root@nova.local",
      referenceIds: ["root@nova.local"],
      subject: "Re: Intro",
    });
  });
});
