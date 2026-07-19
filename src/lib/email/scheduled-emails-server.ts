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
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import {
  resolveSequenceThreadContext,
  type SequenceThreadStep,
} from "@/lib/email/sequence-thread";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

const SCHEDULED_COLLECTION = "scheduledEmails";
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

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
    messageId:
      typeof data.messageId === "string" && data.messageId.trim()
        ? data.messageId.trim()
        : undefined,
    error: data.error ? String(data.error) : undefined,
    cancelledAt: data.cancelledAt ? String(data.cancelledAt) : undefined,
    cancelReason: data.cancelReason ? String(data.cancelReason) : undefined,
    followupId:
      typeof data.followupId === "string" && data.followupId.trim()
        ? data.followupId.trim()
        : undefined,
    leadId:
      typeof data.leadId === "string" && data.leadId.trim() ? data.leadId.trim() : undefined,
    inReplyTo:
      typeof data.inReplyTo === "string" && data.inReplyTo.trim()
        ? data.inReplyTo.trim()
        : undefined,
    referenceIds: Array.isArray(data.referenceIds)
      ? data.referenceIds.map(String).filter(Boolean).slice(-50)
      : undefined,
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
  inReplyTo?: string;
  referenceIds?: string[];
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
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.referenceIds?.length ? { referenceIds: input.referenceIds.slice(-50) } : {}),
  });

  return { ok: true, id: ref.id };
}

export async function cancelScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  id: string;
  reason?: string;
}): Promise<{ ok: true } | { error: string }> {
  const ref = scheduledRef(input.organizationId, input.uid, input.id);
  if (!ref) return { error: "Database not configured" };

  const snap = await ref.get();
  if (!snap.exists) return { error: "Scheduled email not found." };
  const data = snap.data() as Record<string, unknown>;
  if (String(data.status) !== "pending") {
    return { error: "Only pending scheduled emails can be cancelled." };
  }

  const now = new Date().toISOString();
  const reason = (input.reason?.trim() || "Cancelled by user").slice(0, 500);
  await ref.update({
    status: "cancelled",
    cancelledAt: now,
    cancelReason: reason,
    updatedAt: now,
  });
  const followupId =
    typeof data.followupId === "string" ? data.followupId.trim() : "";
  if (followupId) {
    await updateFollowupDeliveryState(followupId, {
      deliveryStatus: "cancelled",
      cancelledAt: now,
      cancelReason: reason,
      clearSchedule: true,
    });
  }
  return { ok: true };
}

async function updateFollowupDeliveryState(
  followupId: string,
  input: {
    deliveryStatus: "sent" | "failed" | "cancelled";
    sentAt?: string;
    sentMessageId?: string;
    failedAt?: string;
    cancelledAt?: string;
    deliveryError?: string;
    cancelReason?: string;
    completedAt?: string;
    clearSchedule?: boolean;
  },
): Promise<string | undefined> {
  const db = getAdminDb();
  if (!db) return undefined;
  try {
    const ref = db.collection(COLLECTIONS.followups).doc(followupId);
    const snap = await ref.get();
    if (!snap.exists) return undefined;
    const current = snap.data() as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      deliveryStatus: input.deliveryStatus,
      updatedAt: new Date().toISOString(),
    };
    if (input.sentAt) patch.sentAt = input.sentAt;
    if (input.sentMessageId) patch.sentMessageId = input.sentMessageId;
    if (input.failedAt) patch.failedAt = input.failedAt;
    if (input.cancelledAt) patch.cancelledAt = input.cancelledAt;
    if (input.deliveryError) patch.deliveryError = input.deliveryError.slice(0, 500);
    if (input.cancelReason) patch.cancelReason = input.cancelReason.slice(0, 500);
    if (input.completedAt) patch.completedAt = input.completedAt;
    if (input.clearSchedule) {
      patch.scheduledEmailId = FieldValue.delete();
      patch.emailScheduledAt = FieldValue.delete();
    }
    await ref.update(patch);
    return typeof current.planId === "string" ? current.planId.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

function followupDocToThreadStep(id: string, data: Record<string, unknown>): SequenceThreadStep {
  return {
    id,
    dueAt: typeof data.dueAt === "string" ? data.dueAt : undefined,
    sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
    emailSubject: typeof data.emailSubject === "string" ? data.emailSubject : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    sentMessageId: typeof data.sentMessageId === "string" ? data.sentMessageId : undefined,
    deliveryStatus: typeof data.deliveryStatus === "string" ? data.deliveryStatus : undefined,
    scheduledEmailId:
      typeof data.scheduledEmailId === "string" ? data.scheduledEmailId : undefined,
    emailScheduledAt:
      typeof data.emailScheduledAt === "string" ? data.emailScheduledAt : undefined,
    pausedAt: typeof data.pausedAt === "string" ? data.pausedAt : undefined,
    completedAt: typeof data.completedAt === "string" ? data.completedAt : undefined,
  };
}

/**
 * Build In-Reply-To / References from earlier sent steps in the same plan.
 * Returns null when this mail already has explicit reply headers (e.g. schedule-from-thread).
 */
async function resolveSequenceThreadingForFollowup(input: {
  followupId: string;
  existingInReplyTo?: string;
}): Promise<
  | { kind: "use_existing" }
  | { kind: "root" }
  | { kind: "wait_for_prior" }
  | { kind: "reply"; inReplyTo: string; referenceIds: string[]; subject: string }
  | { kind: "none" }
> {
  if (normalizeMessageId(input.existingInReplyTo)) {
    return { kind: "use_existing" };
  }

  const db = getAdminDb();
  if (!db) return { kind: "none" };

  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(input.followupId).get();
    if (!snap.exists) return { kind: "none" };
    const currentData = snap.data() as Record<string, unknown>;
    const planId = typeof currentData.planId === "string" ? currentData.planId.trim() : "";
    if (!planId) return { kind: "none" };

    const siblingsSnap = await db
      .collection(COLLECTIONS.followups)
      .where("planId", "==", planId)
      .get();
    const current = followupDocToThreadStep(snap.id, currentData);
    const siblings = siblingsSnap.docs.map((doc) =>
      followupDocToThreadStep(doc.id, doc.data() as Record<string, unknown>),
    );
    return resolveSequenceThreadContext(current, siblings);
  } catch {
    return { kind: "none" };
  }
}

async function releaseScheduledClaim(docRef: DocumentReference): Promise<void> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "pending",
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
  });
}

async function completePlanWhenAllStepsDone(planId: string, completedAt: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  try {
    const steps = await db.collection(COLLECTIONS.followups).where("planId", "==", planId).get();
    if (steps.empty) return;
    const allDone = steps.docs.every((doc) => {
      const step = doc.data() as Record<string, unknown>;
      return step.completedAt != null || step.deliveryStatus === "sent";
    });
    if (!allDone) return;
    const planRef = db.collection(COLLECTIONS.followupPlans).doc(planId);
    const plan = await planRef.get();
    if (!plan.exists) return;
    const status = String((plan.data() as Record<string, unknown>).status ?? "");
    if (status !== "active") return;
    await planRef.update({ status: "completed", completedAt, updatedAt: completedAt });
  } catch {
    /* Best-effort reconciliation; the sent follow-up remains durable. */
  }
}

async function cancelDueToFollowupStop(
  docRef: DocumentReference,
  followupId: string,
  reason: string,
): Promise<"skipped"> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "cancelled",
    error: `Cancelled: ${reason}.`,
    cancelledAt: now,
    cancelReason: reason,
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
  });
  await updateFollowupDeliveryState(followupId, {
    deliveryStatus: "cancelled",
    cancelledAt: now,
    cancelReason: reason,
    clearSchedule: true,
  });
  return "skipped";
}

/** Skip send when the linked followup (or its plan) was paused/completed after a reply. */
async function shouldStopScheduledFollowupEmail(
  followupId: string,
): Promise<string | undefined> {
  const db = getAdminDb();
  if (!db) return undefined;
  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(followupId).get();
    if (!snap.exists) return "Follow-up no longer exists";
    const f = snap.data() as Record<string, unknown>;
    if (f.pausedAt != null) return "Follow-up paused";
    if (f.completedAt != null) return "Follow-up completed";
    const planId = typeof f.planId === "string" ? f.planId.trim() : "";
    if (!planId) return undefined;
    const planSnap = await db.collection(COLLECTIONS.followupPlans).doc(planId).get();
    if (!planSnap.exists) return undefined;
    const status = String((planSnap.data() as Record<string, unknown>).status ?? "");
    if (status === "paused") return "Sequence paused";
    if (status === "superseded") return "Sequence superseded";
    if (status === "completed") return "Sequence completed";
    return undefined;
  } catch {
    return undefined;
  }
}

async function claimScheduledDoc(
  docRef: DocumentReference,
): Promise<Record<string, unknown> | null> {
  const db = getAdminDb();
  if (!db) return null;
  const claimId = crypto.randomUUID();
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const status = String(data.status ?? "");
    const processingAt = new Date(String(data.processingAt ?? "")).getTime();
    const staleProcessing =
      status === "processing" &&
      (!Number.isFinite(processingAt) || Date.now() - processingAt >= PROCESSING_LEASE_MS);
    if (status !== "pending" && !staleProcessing) return null;
    const now = new Date().toISOString();
    transaction.update(docRef, {
      status: "processing",
      processingAt: now,
      processingClaimId: claimId,
      updatedAt: now,
    });
    return { ...data, status: "processing", processingAt: now, processingClaimId: claimId };
  });
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
  const initialStopReason = followupIdEarly
    ? await shouldStopScheduledFollowupEmail(followupIdEarly)
    : undefined;
  if (followupIdEarly && initialStopReason) {
    return cancelDueToFollowupStop(docRef, followupIdEarly, initialStopReason);
  }
  const leadId = typeof data.leadId === "string" ? data.leadId.trim() : "";
  if (leadId) {
    const contactPolicy = await assertLeadContactAllowedServer({ organizationId, leadId });
    if (!contactPolicy.ok) {
      const now = new Date().toISOString();
      const cancelled = contactPolicy.status === 409;
      await docRef.update({
        status: cancelled ? "cancelled" : "failed",
        error: contactPolicy.error,
        ...(cancelled ? { cancelledAt: now, cancelReason: contactPolicy.error } : {}),
        updatedAt: now,
        processingAt: FieldValue.delete(),
        processingClaimId: FieldValue.delete(),
      });
      return cancelled ? "skipped" : "failed";
    }
  }

  const mailboxes = await listMailboxesForMemberServer({ organizationId, uid });
  const mailbox = mailboxes.find((m) => m.id === mailboxId);
  if (!mailbox) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: "Mailbox no longer exists.",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: "Mailbox no longer exists.",
        clearSchedule: true,
      });
    }
    return "failed";
  }

  const quota = await assertMailboxDailySendQuotaServer({
    organizationId,
    uid,
    mailboxId,
    dailySendLimit: mailbox.dailySendLimit,
  });
  if (!quota.ok) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: quota.error,
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: quota.error,
        clearSchedule: true,
      });
    }
    return "failed";
  }

  const parsedAttachments = parseOutboundAttachments(data.attachments);
  if ("error" in parsedAttachments) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: parsedAttachments.error,
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: parsedAttachments.error,
        clearSchedule: true,
      });
    }
    return "failed";
  }

  const finalStopReason = followupIdEarly
    ? await shouldStopScheduledFollowupEmail(followupIdEarly)
    : undefined;
  if (followupIdEarly && finalStopReason) {
    return cancelDueToFollowupStop(docRef, followupIdEarly, finalStopReason);
  }

  let subject = String(data.subject ?? "");
  let inReplyTo = String(data.inReplyTo ?? "") || undefined;
  let referenceIds = Array.isArray(data.referenceIds)
    ? data.referenceIds.map(String).filter(Boolean).slice(-50)
    : undefined;

  if (followupIdEarly) {
    const thread = await resolveSequenceThreadingForFollowup({
      followupId: followupIdEarly,
      existingInReplyTo: inReplyTo,
    });
    if (thread.kind === "wait_for_prior") {
      await releaseScheduledClaim(docRef);
      return "skipped";
    }
    if (thread.kind === "reply") {
      inReplyTo = thread.inReplyTo;
      referenceIds = thread.referenceIds;
      subject = thread.subject;
    }
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
    appendSentCopy:
      mailbox.connectionType === "google_workspace" ||
      mailbox.connectionType === "microsoft_outlook"
        ? false
        : undefined,
    from: String(data.from ?? mailbox.emailAddress),
    displayName: String(data.displayName ?? mailbox.displayName),
    replyTo: String(data.replyTo ?? mailbox.replyTo),
    to: String(data.to ?? ""),
    cc: String(data.cc ?? "") || undefined,
    subject,
    text: String(data.text ?? data.body ?? ""),
    html: String(data.html ?? ""),
    inReplyTo,
    referenceIds,
    attachments: parsedAttachments,
  });

  const now = new Date().toISOString();
  if (result.ok) {
    const messageId = normalizeMessageId(result.messageId);
    await docRef.update({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      error: null,
      ...(messageId ? { messageId } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(referenceIds?.length ? { referenceIds } : {}),
      ...(subject ? { subject } : {}),
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    const followupId =
      typeof data.followupId === "string" ? data.followupId.trim() : "";
    if (followupId) {
      const planId = await updateFollowupDeliveryState(followupId, {
        deliveryStatus: "sent",
        sentAt: now,
        ...(messageId ? { sentMessageId: messageId } : {}),
        completedAt: now,
        clearSchedule: true,
      });
      if (planId) await completePlanWhenAllStepsDone(planId, now);
    }
    try {
      await incrementMailboxSendCountServer({ organizationId, uid, mailboxId });
    } catch {
      /* Delivery is authoritative; quota accounting can recover independently. */
    }
    return "sent";
  }

  await docRef.update({
    status: "failed",
    error: result.error.slice(0, 500),
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
  });
  if (followupIdEarly) {
    await updateFollowupDeliveryState(followupIdEarly, {
      deliveryStatus: "failed",
      failedAt: now,
      deliveryError: result.error,
      clearSchedule: true,
    });
  }
  return "failed";
}

async function processScheduledSnap(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> }>,
): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of docs) {
    const claimed = await claimScheduledDoc(doc.ref);
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      const outcome = await sendScheduledDoc(doc.ref, claimed);
      if (outcome === "sent") sent += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
    } catch {
      // Keep the processing lease. A later processor can safely reclaim it after expiry.
      skipped += 1;
    }
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
    .where("status", "in", ["pending", "processing"])
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
    .where("status", "in", ["pending", "processing"])
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
