import { describe, expect, it } from "vitest";
import {
  detectHardBounce,
  isDeliveryStatusNotification,
  bounceEventDocId,
} from "@/lib/email/detect-hard-bounce";
import { isLikelyAutoReply } from "@/lib/followup-plan-reply";

function msg(
  partial: Partial<{
    from: string;
    to: string;
    subject: string;
    preview: string;
    bodyText: string;
    bodyHtml: string;
    inReplyTo: string;
    referenceIds: string[];
    messageId: string;
  }>,
) {
  return {
    from: partial.from ?? "",
    to: partial.to ?? "",
    subject: partial.subject ?? "",
    preview: partial.preview ?? "",
    bodyText: partial.bodyText ?? "",
    bodyHtml: partial.bodyHtml,
    inReplyTo: partial.inReplyTo,
    referenceIds: partial.referenceIds,
    messageId: partial.messageId,
  };
}

describe("detectHardBounce — Gmail Address not found", () => {
  const gmailDsn = msg({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    preview: "Address not found",
    bodyText: `Your message wasn't delivered to andrew@bopofit.com because the domain bopofit.com couldn't be found. Check for typos or unnecessary spaces and try again.

Final-Recipient: rfc822; andrew@bopofit.com
Action: failed
Status: 5.1.2
Original-Message-ID: <abc-123@mailtech360.com>
`,
  });

  it("detects Gmail hard bounce and extracts recipient + original Message-ID", () => {
    expect(isDeliveryStatusNotification(gmailDsn)).toBe(true);
    const bounce = detectHardBounce(gmailDsn);
    expect(bounce).not.toBeNull();
    expect(bounce!.bounceKind).toBe("hard");
    expect(bounce!.failedRecipients).toContain("andrew@bopofit.com");
    expect(bounce!.originalMessageId).toBe("abc-123@mailtech360.com");
    expect(bounce!.reason.toLowerCase()).toMatch(/address not found|domain|5\.1/);
  });

  it("extracts recipient from HTML-only Gmail DSN body", () => {
    const htmlOnly = msg({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      preview: "Address not found",
      bodyText: "",
      bodyHtml: `<div><h2>Address not found</h2><p>Your message wasn't delivered to <a>andrew@bopofit.com</a> because the domain bopofit.com couldn't be found.</p></div>`,
    });
    const bounce = detectHardBounce(htmlOnly as Parameters<typeof detectHardBounce>[0]);
    expect(bounce).not.toBeNull();
    expect(bounce!.failedRecipients).toContain("andrew@bopofit.com");
  });

  it("is not treated as a human auto-reply for sequence pause", () => {
    expect(isDeliveryStatusNotification(gmailDsn)).toBe(true);
    expect(isLikelyAutoReply(gmailDsn)).toBe(false);
  });
});

describe("detectHardBounce — soft bounce", () => {
  it("classifies mailbox full as soft", () => {
    const soft = msg({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Delay)",
      bodyText: `The recipient's mailbox is full. Try again later.
Final-Recipient: rfc822; full@example.com
Status: 4.2.2
`,
    });
    const bounce = detectHardBounce(soft);
    expect(bounce).not.toBeNull();
    expect(bounce!.bounceKind).toBe("soft");
    expect(bounce!.failedRecipients).toContain("full@example.com");
  });
});

describe("detectHardBounce — out of office", () => {
  it("does not treat OOO as a bounce", () => {
    const ooo = msg({
      from: "Jane Doe <jane@acme.com>",
      subject: "Out of Office: Jane Doe",
      preview: "I am currently out of the office with limited access to email.",
      bodyText: "I am currently out of the office and will return Monday.",
    });
    expect(isDeliveryStatusNotification(ooo)).toBe(false);
    expect(detectHardBounce(ooo)).toBeNull();
    expect(isLikelyAutoReply(ooo)).toBe(true);
  });
});

describe("bounceEventDocId", () => {
  it("sanitizes mailbox and message ids", () => {
    expect(bounceEventDocId("mb:1", "in/99")).toBe("mb_1_in_99");
  });
});
