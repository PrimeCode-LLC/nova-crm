import { randomUUID } from "node:crypto";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/documents/tenant-write";

export type ScheduledEmailPostprocessItem = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  scheduledEmailId: string;
  leadId?: string;
  followupId?: string;
  scheduledByUserId?: string;
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

async function recordScheduledEmailSentTimeline(
  item: ScheduledEmailPostprocessItem,
): Promise<boolean> {
  const db = getAdminDb();
  const leadId = item.leadId?.trim();
  if (!db || !leadId) return false;

  let leadOwnerId = item.uid;
  try {
    const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
    if (leadSnap.exists) {
      const owner = (leadSnap.data() as Record<string, unknown>).ownerId;
      if (typeof owner === "string" && owner.trim()) leadOwnerId = owner.trim();
    }
  } catch {
    /* keep mailbox owner */
  }

  const actorId = item.scheduledByUserId?.trim() || leadOwnerId || item.uid;
  const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
  const teId = `te-${randomUUID()}`;
  await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
    stampForCreate(
      item.organizationId,
      {
        leadId,
        leadOwnerId,
        leadOwnerManagerIds,
        type: "email_sent",
        actorId,
        summary: `Email sent: ${item.subject.trim() || "(no subject)"}`,
        payload: {
          source: "scheduled",
          mailboxId: item.mailboxId,
          ...(item.scheduledByUserId?.trim()
            ? { scheduledByUserId: item.scheduledByUserId.trim() }
            : {}),
          ...(item.uid !== actorId ? { mailboxOwnerUid: item.uid } : {}),
          ...(item.messageId ? { messageId: item.messageId } : {}),
          ...(item.followupId ? { followupId: item.followupId } : {}),
        },
      },
      actorId,
    ),
  );
  return true;
}

/**
 * P1.3 companion to Cloud Functions scheduled send.
 * Persists lead-mail, timeline, and reply-intel for messages already marked sent on CF.
 */
export async function runScheduledEmailPostprocessCronServer(
  items: ScheduledEmailPostprocessItem[],
): Promise<{
  processed: number;
  leadMail: number;
  timeline: number;
  replyIntel: number;
  errors: number;
}> {
  let leadMail = 0;
  let timeline = 0;
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
      if (await recordScheduledEmailSentTimeline(item)) timeline += 1;
    } catch {
      errors += 1;
    }
    try {
      await resolvePendingReplyActionOnOutboundServer({
        organizationId: item.organizationId,
        leadId: item.leadId,
        decidedBy: item.scheduledByUserId || item.uid,
        messageId: item.messageId,
        sentAt: item.sentAt,
      });
      replyIntel += 1;
    } catch {
      /* best-effort */
    }
  }

  return { processed: items.length, leadMail, timeline, replyIntel, errors };
}
