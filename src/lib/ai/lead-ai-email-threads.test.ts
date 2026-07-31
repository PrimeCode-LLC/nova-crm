import { describe, expect, it } from "vitest";
import { buildLeadAiEmailThreadsFromMail } from "@/lib/ai/lead-ai-email-threads";
import type { LeadMailMessage } from "@/lib/email/lead-mail-types";

function mail(partial: Partial<LeadMailMessage> & Pick<LeadMailMessage, "direction" | "subject" | "date" | "from">): LeadMailMessage {
  return {
    id: partial.id ?? "id",
    organizationId: "org",
    leadId: "lead",
    mailboxId: "mb",
    mailboxOwnerUid: "u",
    providerKey: partial.providerKey ?? "pk",
    to: partial.to ?? "them@example.com",
    preview: partial.preview ?? "",
    bodyText: partial.bodyText ?? "",
    bodySynced: true,
    source: "imap",
    createdAt: partial.date,
    updatedAt: partial.date,
    ...partial,
  };
}

describe("buildLeadAiEmailThreadsFromMail", () => {
  it("groups inbound and outbound into chronological threads", () => {
    const threads = buildLeadAiEmailThreadsFromMail([
      mail({
        direction: "outbound",
        subject: "Workflow help",
        from: "us@agency.com",
        to: "ada@example.com",
        date: "2026-07-01T10:00:00.000Z",
        bodyText: "Curious if automation would help.",
      }),
      mail({
        direction: "inbound",
        subject: "Re: Workflow help",
        from: "ada@example.com",
        to: "us@agency.com",
        date: "2026-07-02T12:00:00.000Z",
        bodyText: "We are evaluating this next quarter.\n\nOn Jul 1, us wrote:\n> Curious if automation would help.",
      }),
      mail({
        direction: "outbound",
        subject: "Re: Workflow help",
        from: "us@agency.com",
        to: "ada@example.com",
        date: "2026-07-03T09:00:00.000Z",
        bodyText: "Happy to share a short demo.",
      }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].subject).toBe("Workflow help");
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].messages.map((m) => m.direction)).toEqual([
      "outbound",
      "inbound",
      "outbound",
    ]);
    expect(threads[0].messages[1].snippet).toContain("next quarter");
    expect(threads[0].messages[1].snippet).not.toContain("Curious if automation");
  });
});
