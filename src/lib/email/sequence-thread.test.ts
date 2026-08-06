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

  it("starts a new thread when freshThread ignores prior non-fresh sent steps", () => {
    const result = resolveSequenceThreadContext(
      {
        id: "f3",
        dueAt: "2026-02-01T10:00:00.000Z",
        title: "New campaign",
        freshThread: true,
      },
      [
        {
          id: "f1",
          dueAt: "2026-01-01T10:00:00.000Z",
          emailSubject: "Old campaign",
          deliveryStatus: "sent",
          sentAt: "2026-01-01T10:05:00.000Z",
          sentMessageId: "old-root@nova.local",
        },
        {
          id: "f3",
          dueAt: "2026-02-01T10:00:00.000Z",
          title: "New campaign",
          freshThread: true,
        },
      ],
    );
    expect(result).toEqual({ kind: "root" });
  });

  it("chains freshThread steps together after the first fresh send", () => {
    const result = resolveSequenceThreadContext(
      {
        id: "f4",
        dueAt: "2026-02-05T10:00:00.000Z",
        title: "Second fresh",
        freshThread: true,
      },
      [
        {
          id: "f1",
          dueAt: "2026-01-01T10:00:00.000Z",
          emailSubject: "Old campaign",
          deliveryStatus: "sent",
          sentMessageId: "old-root@nova.local",
          sentAt: "2026-01-01T10:05:00.000Z",
        },
        {
          id: "f3",
          dueAt: "2026-02-01T10:00:00.000Z",
          emailSubject: "New campaign intro",
          deliveryStatus: "sent",
          sentMessageId: "fresh-root@nova.local",
          sentAt: "2026-02-01T10:05:00.000Z",
          freshThread: true,
        },
        {
          id: "f4",
          dueAt: "2026-02-05T10:00:00.000Z",
          title: "Second fresh",
          freshThread: true,
        },
      ],
    );
    expect(result).toEqual({
      kind: "reply",
      inReplyTo: "fresh-root@nova.local",
      referenceIds: ["fresh-root@nova.local"],
      subject: "Re: New campaign intro",
    });
  });

  it("threads a regenerated plan's first step onto the reply it was built from", () => {
    const result = resolveSequenceThreadContext(
      { id: "f1", dueAt: "2026-03-01T10:00:00.000Z", title: "Answer their timing question" },
      [{ id: "f1", dueAt: "2026-03-01T10:00:00.000Z", title: "Answer their timing question" }],
      {
        inReplyTo: "<their-reply@prospect.example>",
        referenceIds: ["<our-intro@nova.local>"],
        subject: "Re: cutting onboarding time",
      },
    );
    expect(result).toEqual({
      kind: "reply",
      inReplyTo: "their-reply@prospect.example",
      referenceIds: ["our-intro@nova.local", "their-reply@prospect.example"],
      subject: "Re: cutting onboarding time",
    });
  });

  it("prefers the plan's own sent step over the anchor once it exists", () => {
    const result = resolveSequenceThreadContext(
      { id: "f2", dueAt: "2026-03-05T10:00:00.000Z", title: "Second touch" },
      [
        {
          id: "f1",
          dueAt: "2026-03-01T10:00:00.000Z",
          emailSubject: "Re: cutting onboarding time",
          deliveryStatus: "sent",
          sentAt: "2026-03-01T10:05:00.000Z",
          sentMessageId: "our-reply@nova.local",
        },
        { id: "f2", dueAt: "2026-03-05T10:00:00.000Z", title: "Second touch" },
      ],
      { inReplyTo: "their-reply@prospect.example", subject: "cutting onboarding time" },
    );
    expect(result).toEqual({
      kind: "reply",
      inReplyTo: "our-reply@nova.local",
      referenceIds: ["our-reply@nova.local"],
      subject: "Re: cutting onboarding time",
    });
  });

  it("ignores the anchor when the step is explicitly a fresh thread", () => {
    const result = resolveSequenceThreadContext(
      { id: "f1", dueAt: "2026-03-01T10:00:00.000Z", title: "New angle", freshThread: true },
      [{ id: "f1", dueAt: "2026-03-01T10:00:00.000Z", title: "New angle", freshThread: true }],
      { inReplyTo: "their-reply@prospect.example", subject: "cutting onboarding time" },
    );
    expect(result).toEqual({ kind: "root" });
  });
});
