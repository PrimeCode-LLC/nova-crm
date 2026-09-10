/**
 * Durable compose/inbox/reply SMTP send events for dashboard “Emails sent”.
 * Sequence steps are NOT recorded here — they already count via followups.
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate } from "@/lib/documents/tenant-write";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { scheduleOrgDashboardSummaryRefresh } from "@/lib/db/org-dashboard-summary-refresh";

export type EmailSendEventSource = "smtp_send" | "reply_intelligence";

export type EmailSendEvent = {
  id: string;
  organizationId: string;
  actorId: string;
  sentAt: string;
  source: EmailSendEventSource;
  mailboxId?: string;
  leadId?: string;
  messageId?: string;
  subject?: string;
};

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

/** Persist a compose/reply send so org summary + KPIs can count it. */
export async function recordEmailSendEventServer(input: {
  organizationId: string;
  actorId: string;
  sentAt?: string;
  source: EmailSendEventSource;
  mailboxId?: string;
  leadId?: string;
  messageId?: string;
  subject?: string;
  /** When set with leadId, also writes a lead timeline `email_sent` row. */
  writeTimeline?: boolean;
}): Promise<void> {
  const organizationId = input.organizationId.trim();
  const actorId = input.actorId.trim();
  if (!organizationId || !actorId) return;

  const db = getAdminDb();
  if (!db) return;

  const sentAt = input.sentAt?.trim() || new Date().toISOString();
  const eventId = `ese-${crypto.randomUUID()}`;
  const leadId = input.leadId?.trim() || undefined;
  const mailboxId = input.mailboxId?.trim() || undefined;
  const messageId = input.messageId?.trim() || undefined;
  const subject = input.subject?.trim() || undefined;

  try {
    await db.collection(COLLECTIONS.emailSendEvents).doc(eventId).set(
      stampForCreate(
        organizationId,
        {
          actorId,
          sentAt,
          source: input.source,
          ...(mailboxId ? { mailboxId } : {}),
          ...(leadId ? { leadId } : {}),
          ...(messageId ? { messageId } : {}),
          ...(subject ? { subject } : {}),
        },
        actorId,
      ),
    );
  } catch (err) {
    console.error(
      "[email-send-event] write failed",
      organizationId,
      err instanceof Error ? err.message : err,
    );
  }

  if (input.writeTimeline !== false && leadId) {
    try {
      let leadOwnerId: string | undefined;
      let leadOwnerManagerIds: string[] | undefined;
      try {
        const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
        if (leadSnap.exists) {
          leadOwnerId = String(leadSnap.data()?.ownerId ?? "").trim() || undefined;
          if (leadOwnerId) {
            leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
          }
        }
      } catch {
        /* timeline attribution best-effort */
      }
      const teId = `te-${crypto.randomUUID()}`;
      await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
        stampForCreate(
          organizationId,
          {
            leadId,
            ...(leadOwnerId ? { leadOwnerId } : {}),
            ...(leadOwnerManagerIds?.length ? { leadOwnerManagerIds } : {}),
            type: "email_sent",
            actorId,
            summary: `Email sent: ${subject || "(no subject)"}`,
            payload: {
              source: input.source,
              ...(mailboxId ? { mailboxId } : {}),
              ...(messageId ? { messageId } : {}),
            },
            createdAt: sentAt,
          },
          actorId,
        ),
      );
    } catch {
      /* timeline best-effort */
    }
  }

  scheduleOrgDashboardSummaryRefresh(organizationId);
}

/** Load compose/reply send timestamps for org dashboard summary recompute. */
export async function loadEmailSendEventAtsFromServer(
  organizationId: string,
): Promise<number[]> {
  const orgId = organizationId.trim();
  if (!orgId) return [];
  const db = getAdminDb();
  if (!db) return [];

  try {
    const snap = await db
      .collection(COLLECTIONS.emailSendEvents)
      .where("organizationId", "==", orgId)
      .get();
    const ats: number[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const at = validTime(typeof data.sentAt === "string" ? data.sentAt : undefined);
      if (at !== undefined) ats.push(at);
    }
    return ats;
  } catch (err) {
    console.error(
      "[email-send-event] load failed",
      orgId,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
