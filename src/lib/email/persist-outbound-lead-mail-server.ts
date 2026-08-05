import type { MailInboundAttachment } from "@/lib/email-account-types";
import { upsertLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import type { LeadMailSource } from "@/lib/email/lead-mail-types";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

/** Persist an outbound send onto the lead mail store (Emails tab). */
export async function persistOutboundLeadMailServer(input: {
  organizationId: string;
  leadId: string | undefined;
  mailboxId: string;
  mailboxOwnerUid: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  sentAt: string;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  attachments?: MailInboundAttachment[];
  source: LeadMailSource;
}): Promise<void> {
  const leadId = input.leadId?.trim();
  if (!leadId || !input.mailboxId.trim()) return;

  const messageId = normalizeMessageId(input.messageId);
  const localId = messageId || `sent-${input.sentAt}-${input.to.slice(0, 40)}`;
  const preview = (input.bodyText || input.subject).replace(/\s+/g, " ").trim().slice(0, 240);

  try {
    await upsertLeadMailMessagesServer({
      organizationId: input.organizationId,
      leadId,
      mailboxOwnerUid: input.mailboxOwnerUid,
      messages: [
        {
          mailboxId: input.mailboxId,
          mailboxOwnerUid: input.mailboxOwnerUid,
          direction: "outbound",
          providerKey: leadMailProviderKey({
            mailboxId: input.mailboxId,
            direction: "outbound",
            localId,
          }),
          subject: input.subject,
          from: input.from,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          replyTo: input.replyTo,
          date: input.sentAt,
          seen: true,
          preview,
          bodyText: input.bodyText,
          bodyHtml: input.bodyHtml,
          bodySynced: true,
          messageId,
          inReplyTo: normalizeMessageId(input.inReplyTo),
          referenceIds: input.referenceIds,
          attachments: input.attachments ?? [],
          source: input.source,
        },
      ],
    });
  } catch {
    /* send/schedule already succeeded */
  }
}
