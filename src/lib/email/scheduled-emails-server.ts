import type { DocumentReference } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { ScheduledEmail, ScheduledEmailStatus } from "@/lib/email-account-types";
import {
  parseOutboundAttachments,
  serializeOutboundAttachments,
  type OutboundAttachmentPayload,
} from "@/lib/email/outbound-attachments";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import { listMailboxesForMemberServer } from "@/lib/email/mailbox-profiles-server";
import {
  assertMailboxDailySendQuotaServer,
  incrementMailboxSendCountServer,
} from "@/lib/email/mailbox-send-quota-server";

const SCHEDULED_COLLECTION = "scheduledEmails";

function scheduledRef(orgId: string, uid: string, id: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection(SCHEDULED_COLLECTION)
    .doc(id);
}

function docToScheduled(id: string, data: Record<string, unknown>): ScheduledEmail {
  const attachmentsRaw = data.attachments;
  const attachments = Array.isArray(attachmentsRaw)
    ? attachmentsRaw
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const rec = item as Record<string, unknown>;
          const filename = String(rec.filename ?? "attachment").trim() || "attachment";
          const contentBase64 = String(rec.contentBase64 ?? "").trim();
          const mimeType = String(rec.mimeType ?? rec.contentType ?? "application/octet-stream").trim();
          if (!contentBase64) return null;
          return { filename, mimeType, contentBase64 };
        })
        .filter((a): a is OutboundAttachmentPayload => a != null)
    : [];

  return {
    id,
    mailboxId: String(data.mailboxId ?? ""),
    from: String(data.from ?? ""),
    displayName: String(data.displayName ?? ""),
    replyTo: String(data.replyTo ?? ""),
    to: String(data.to ?? ""),
    cc: data.cc ? String(data.cc) : undefined,
    subject: String(data.subject ?? ""),
    body: String(data.body ?? data.text ?? ""),
    text: String(data.text ?? data.body ?? ""),
    html: String(data.html ?? ""),
    attachments,
    scheduledAt: String(data.scheduledAt ?? ""),
    status: (String(data.status ?? "pending") as ScheduledEmailStatus) || "pending",
    createdAt: String(data.createdAt ?? ""),
    sentAt: data.sentAt ? String(data.sentAt) : undefined,
    error: data.error ? String(data.error) : undefined,
    followupId:
      typeof data.followupId === "string" && data.followupId.trim()
        ? data.followupId.trim()
        : undefined,
    leadId:
      typeof data.leadId === "string" && data.leadId.trim() ? data.leadId.trim() : undefined,
  };
}

export async function listScheduledEmailsForMemberServer(input: {
  organizationId: string;
  uid: string;
  status?: ScheduledEmailStatus | "pending" | "done";
}): Promise<ScheduledEmail[]> {
  const db = getAdminDb();
  if (!db) return [];

  const root = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(input.uid)
    .collection(SCHEDULED_COLLECTION);

  let q = root.orderBy("scheduledAt", "desc").limit(200);
  if (input.status === "pending") {
    q = root.where("status", "==", "pending").orderBy("scheduledAt", "asc").limit(200);
  } else if (input.status === "done") {
    q = root.where("status", "in", ["sent", "failed", "cancelled"]).orderBy("scheduledAt", "desc").limit(200);
  }

  const snap = await q.get();
  return snap.docs.map((doc) => docToScheduled(doc.id, doc.data() as Record<string, unknown>));
}

export async function createScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  from: string;
  displayName?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: unknown;
  scheduledAt: string;
  followupId?: string;
  leadId?: string;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const ref = scheduledRef(input.organizationId, input.uid, `sch-${crypto.randomUUID()}`);
  if (!ref) return { error: "Database not configured" };

  const scheduledDate = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { error: "Invalid schedule date." };
  }
  if (scheduledDate.getTime() < Date.now() + 60_000) {
    return { error: "Schedule time must be at least 1 minute in the future." };
  }

  const parsedAttachments = parseOutboundAttachments(input.attachments);
  if ("error" in parsedAttachments) return { error: parsedAttachments.error };

  const now = new Date().toISOString();
  const followupId = input.followupId?.trim() || "";
  const leadId = input.leadId?.trim() || "";
  await ref.set({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: input.mailboxId,
    from: input.from,
    displayName: input.displayName ?? "",
    replyTo: input.replyTo ?? "",
    to: input.to,
    cc: input.cc ?? "",
    subject: input.subject,
    body: input.text,
    text: input.text,
    html: input.html,
    attachments: serializeOutboundAttachments(parsedAttachments),
    scheduledAt: scheduledDate.toISOString(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...(followupId ? { followupId } : {}),
    ...(leadId ? { leadId } : {}),
  });

  return { ok: true, id: ref.id };
}

export async function cancelScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  id: string;
}): Promise<{ ok: true } | { error: string }> {
  const ref = scheduledRef(input.organizationId, input.uid, input.id);
  if (!ref) return { error: "Database not configured" };

  const snap = await ref.get();
  if (!snap.exists) return { error: "Scheduled email not found." };
  const data = snap.data() as Record<string, unknown>;
  if (String(data.status) !== "pending") {
    return { error: "Only pending scheduled emails can be cancelled." };
  }

  await ref.update({
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  });
  return { ok: true };
}

async function cancelDueToFollowupStop(
  docRef: DocumentReference,
  followupId: string,
): Promise<"skipped"> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "cancelled",
    error: "Cancelled: follow-up paused or completed after lead reply.",
    updatedAt: now,
  });
  try {
    const db = getAdminDb();
    if (db) {
      await db.collection(COLLECTIONS.followups).doc(followupId).update({
        scheduledEmailId: FieldValue.delete(),
        emailScheduledAt: FieldValue.delete(),
        updatedAt: now,
      });
    }
  } catch {
    /* Follow-up may already be deleted. */
  }
  return "skipped";
}

/** Skip send when the linked followup (or its plan) was paused/completed after a reply. */
async function shouldStopScheduledFollowupEmail(
  followupId: string,
): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return false;
  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(followupId).get();
    if (!snap.exists) return true;
    const f = snap.data() as Record<string, unknown>;
    if (f.pausedAt != null || f.completedAt != null) return true;
    const planId = typeof f.planId === "string" ? f.planId.trim() : "";
    if (!planId) return false;
    const planSnap = await db.collection(COLLECTIONS.followupPlans).doc(planId).get();
    if (!planSnap.exists) return false;
    const status = String((planSnap.data() as Record<string, unknown>).status ?? "");
    return status === "paused" || status === "superseded" || status === "completed";
  } catch {
    return false;
  }
}

async function sendScheduledDoc(
  docRef: DocumentReference,
  data: Record<string, unknown>,
): Promise<"sent" | "failed" | "skipped"> {
  const organizationId = String(data.organizationId ?? "");
  const uid = String(data.uid ?? "");
  const mailboxId = String(data.mailboxId ?? "");
  if (!organizationId || !uid || !mailboxId) return "skipped";

  const followupIdEarly =
    typeof data.followupId === "string" ? data.followupId.trim() : "";
  if (followupIdEarly && (await shouldStopScheduledFollowupEmail(followupIdEarly))) {
    return cancelDueToFollowupStop(docRef, followupIdEarly);
  }

  const mailboxes = await listMailboxesForMemberServer({ organizationId, uid });
  const mailbox = mailboxes.find((m) => m.id === mailboxId);
  if (!mailbox) {
    await docRef.update({
      status: "failed",
      error: "Mailbox no longer exists.",
      updatedAt: new Date().toISOString(),
    });
    return "failed";
  }

  const quota = await assertMailboxDailySendQuotaServer({
    organizationId,
    uid,
    mailboxId,
    dailySendLimit: mailbox.dailySendLimit,
  });
  if (!quota.ok) {
    await docRef.update({
      status: "failed",
      error: quota.error,
      updatedAt: new Date().toISOString(),
    });
    return "failed";
  }

  const parsedAttachments = parseOutboundAttachments(data.attachments);
  if ("error" in parsedAttachments) {
    await docRef.update({
      status: "failed",
      error: parsedAttachments.error,
      updatedAt: new Date().toISOString(),
    });
    return "failed";
  }

  const result = await sendOutboundMailServer({
    organizationId,
    uid,
    mailboxId,
    smtp: {
      host: mailbox.smtp.host,
      port: mailbox.smtp.port,
      secure: mailbox.smtp.secure,
      user: mailbox.smtp.user,
      pass: mailbox.smtp.password,
    },
    imap: {
      host: mailbox.imap.host,
      port: mailbox.imap.port,
      secure: mailbox.imap.secure,
      user: mailbox.imap.user,
      pass: mailbox.imap.password,
    },
    from: String(data.from ?? mailbox.emailAddress),
    displayName: String(data.displayName ?? mailbox.displayName),
    replyTo: String(data.replyTo ?? mailbox.replyTo),
    to: String(data.to ?? ""),
    cc: String(data.cc ?? "") || undefined,
    subject: String(data.subject ?? ""),
    text: String(data.text ?? data.body ?? ""),
    html: String(data.html ?? ""),
    attachments: parsedAttachments,
  });

  const now = new Date().toISOString();
  if (result.ok) {
    await incrementMailboxSendCountServer({ organizationId, uid, mailboxId });
    await docRef.update({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      error: null,
    });
    const followupId =
      typeof data.followupId === "string" ? data.followupId.trim() : "";
    if (followupId) {
      try {
        const db = getAdminDb();
        if (db) {
          await db.collection(COLLECTIONS.followups).doc(followupId).update({
            scheduledEmailId: FieldValue.delete(),
            emailScheduledAt: FieldValue.delete(),
            updatedAt: now,
          });
        }
      } catch {
        /* Follow-up may already be deleted; send still succeeded. */
      }
    }
    return "sent";
  }

  await docRef.update({
    status: "failed",
    error: result.error.slice(0, 500),
    updatedAt: now,
  });
  return "failed";
}

async function processScheduledSnap(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> }>,
): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of docs) {
    const outcome = await sendScheduledDoc(doc.ref, doc.data());
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return { processed: docs.length, sent, failed, skipped };
}

/**
 * Dev/local helper: process due emails for one mailbox owner.
 * Production cron continues to use processDueScheduledEmailsServer (collection group).
 */
export async function processDueScheduledEmailsForMemberServer(input: {
  organizationId: string;
  uid: string;
}): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  const db = getAdminDb();
  if (!db) return { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const now = new Date().toISOString();
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(input.uid)
    .collection(SCHEDULED_COLLECTION)
    .where("status", "==", "pending")
    .where("scheduledAt", "<=", now)
    .limit(50)
    .get();

  return processScheduledSnap(
    snap.docs.map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    })),
  );
}

export async function processDueScheduledEmailsServer(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const db = getAdminDb();
  if (!db) return { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const now = new Date().toISOString();
  const snap = await db
    .collectionGroup(SCHEDULED_COLLECTION)
    .where("status", "==", "pending")
    .where("scheduledAt", "<=", now)
    .limit(50)
    .get();

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const outcome = await sendScheduledDoc(doc.ref, data);
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return { processed: snap.size, sent, failed, skipped };
}
