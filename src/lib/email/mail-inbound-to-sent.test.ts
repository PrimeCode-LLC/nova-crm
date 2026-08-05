import { describe, expect, it } from "vitest";
import { mailInboundToSent, mergeSentMailRow } from "@/lib/email/mail-inbound-to-sent";
import type { MailInbound, MailSent } from "@/lib/email-account-types";

function inbound(partial: Partial<MailInbound> & Pick<MailInbound, "uid" | "subject">): MailInbound {
  return {
    id: `uid-${partial.uid}`,
    from: "a@x.com",
    to: "b@y.com",
    date: "2026-08-01T00:00:00.000Z",
    seen: true,
    preview: partial.preview ?? partial.subject,
    bodyText: partial.bodyText ?? "",
    ...partial,
  };
}

describe("mailInboundToSent", () => {
  it("does not treat a subject-only Sent head as a synced body", () => {
    const sent = mailInboundToSent(
      "mb1",
      inbound({
        uid: 12,
        subject: "Email 1 - Intro",
        preview: "Email 1 - Intro",
        bodyText: "Email 1 - Intro",
        bodySynced: true,
      }),
    );
    expect(sent.body).toBe("");
    expect(sent.bodySynced).toBe(false);
  });
});

describe("mergeSentMailRow", () => {
  it("keeps a real local body when IMAP returns the subject stub", () => {
    const prev: MailSent = {
      id: "local",
      mailboxId: "mb1",
      from: "a@x.com",
      to: "b@y.com",
      subject: "Email 1 - Intro",
      body: "Hi Sam, this is the real email.",
      sentAt: "2026-08-01T00:00:00.000Z",
      bodySynced: true,
    };
    const server: MailSent = {
      id: "mb1:sent:uid-12",
      mailboxId: "mb1",
      from: "a@x.com",
      to: "b@y.com",
      subject: "Email 1 - Intro",
      body: "Email 1 - Intro",
      sentAt: "2026-08-01T00:00:00.000Z",
      uid: 12,
      bodySynced: true,
      preview: "Email 1 - Intro",
    };
    expect(mergeSentMailRow(prev, server).body).toBe("Hi Sam, this is the real email.");
  });
});
