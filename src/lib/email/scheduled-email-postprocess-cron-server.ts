import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";

export type ScheduledEmailPostprocessItem = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  scheduledEmailId: string;
  leadId?: string;
  followupId?: string;
  messageId?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  text: string;
  html: string;
  inReplyTo?: string;
  referenceIds?: string[];
  sentAt: string;
};

/**
 * P1.3 companion to Cloud Functions scheduled send.
 * Persists lead-mail + reply-intel cleanup for messages already marked sent on CF.
 */
export async function runScheduledEmailPostprocessCronServer(
  items: ScheduledEmailPostprocessItem[],
): Promise<{ processed: number; leadMail: number; replyIntel: number; errors: number }> {
  let leadMail = 0;
  let replyIntel = 0;
  let errors = 0;

  for (const item of items.slice(0, 50)) {
    if (!item.leadId?.trim()) continue;
    try {
      await persistOutboundLeadMailServer({
        organizationId: item.organizationId,
        leadId: item.leadId,
        mailboxId: item.mailboxId,
        mailboxOwnerUid: item.uid,
        from: item.from,
        to: item.to,
        cc: item.cc,
        bcc: item.bcc,
        replyTo: item.replyTo,
        subject: item.subject,
        bodyText: item.text,
        bodyHtml: item.html || undefined,
        sentAt: item.sentAt,
        messageId: item.messageId,
        inReplyTo: item.inReplyTo,
        referenceIds: item.referenceIds,
        source: item.followupId ? "crm_followup" : "scheduled",
      });
      leadMail += 1;
    } catch {
      errors += 1;
    }
    try {
      await resolvePendingReplyActionOnOutboundServer({
        organizationId: item.organizationId,
        leadId: item.leadId,
        decidedBy: item.uid,
        messageId: item.messageId,
        sentAt: item.sentAt,
      });
      replyIntel += 1;
    } catch {
      /* best-effort */
    }
  }

  return { processed: items.length, leadMail, replyIntel, errors };
}
