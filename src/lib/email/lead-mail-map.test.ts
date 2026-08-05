import { describe, expect, it } from "vitest";
import { mergeLeadEmailMessages, sentNeedsAttachmentBackfill, sentToLeadMailUpsert } from "@/lib/email/lead-mail-map";
import type { LeadEmailMessage } from "@/lib/email/lead-email-conversations";
import type { MailSent } from "@/lib/email-account-types";

function sentMessage(partial: Partial<MailSent> & Pick<MailSent, "id" | "body">): MailSent {
  return {
    mailboxId: "mb1",
    from: "hannan@stellixsoft.com",
    to: "sd@nutrioz.com",
    subject: "Proposal",
    sentAt: "2026-08-05T03:00:00.000Z",
    bodySynced: true,
    ...partial,
  };
}

describe("sentToLeadMailUpsert", () => {
  it("includes attachments so the Emails tab can show them later", () => {
    const upsert = sentToLeadMailUpsert(
      sentMessage({
        id: "s-1",
        body: "Hi Simas, I attached the proposal.",
        messageId: "abc@stellixsoft.com",
        attachments: [
          {
            filename: "Nutrioz-proposal.pdf",
            mimeType: "application/pdf",
            sizeBytes: 120_000,
            contentBase64: "cHJvcG9zYWw=",
          },
        ],
      }),
      "smtp_send",
    );
    expect(upsert.attachments).toHaveLength(1);
    expect(upsert.attachments?.[0]?.filename).toBe("Nutrioz-proposal.pdf");
  });
});

describe("mergeLeadEmailMessages", () => {
  it("merges a CRM sent copy with the IMAP sent copy by Message-ID and keeps attachments", () => {
    const stored: LeadEmailMessage = {
      key: "mb1:out:abc@stellixsoft.com",
      mailboxId: "mb1",
      direction: "sent",
      message: sentMessage({
        id: "abc@stellixsoft.com",
        body: "Hi Simas, I attached the proposal.",
        messageId: "abc@stellixsoft.com",
      }),
    };
    const live: LeadEmailMessage = {
      key: "mb1:sent:uid-44",
      mailboxId: "mb1",
      direction: "sent",
      message: sentMessage({
        id: "mb1:sent:uid-44",
        uid: 44,
        body: "",
        bodySynced: false,
        messageId: "abc@stellixsoft.com",
        attachments: [
          { filename: "Nutrioz-proposal.pdf", mimeType: "application/pdf", sizeBytes: 180_000 },
        ],
      }),
    };

    const merged = mergeLeadEmailMessages([stored], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.direction).toBe("sent");
    if (merged[0]?.direction !== "sent") return;
    expect(merged[0].message.body).toContain("attached the proposal");
    expect(merged[0].message.uid).toBe(44);
    expect(merged[0].message.attachments?.[0]?.filename).toBe("Nutrioz-proposal.pdf");
  });

  it("flags stored CRM sends with a Message-ID and no attachment metadata for IMAP backfill", () => {
    const row: LeadEmailMessage = {
      key: "mb1:out:abc@stellixsoft.com",
      mailboxId: "mb1",
      direction: "sent",
      message: sentMessage({
        id: "abc@stellixsoft.com",
        body: "I have attached a founder-level proposal.",
        messageId: "abc@stellixsoft.com",
        attachments: [],
      }),
    };
    expect(sentNeedsAttachmentBackfill(row)).toBe(true);
    expect(
      sentNeedsAttachmentBackfill({
        ...row,
        message: {
          ...row.message,
          attachments: [{ filename: "proposal.pdf", mimeType: "application/pdf", sizeBytes: 10 }],
        },
      }),
    ).toBe(false);
  });
});
