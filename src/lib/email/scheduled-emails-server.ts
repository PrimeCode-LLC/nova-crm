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
  getMailboxLastSentAtServer,
  incrementMailboxSendCountServer,
} from "@/lib/email/mailbox-send-quota-server";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";
import {
  resolveSequenceThreadContext,
  type SequenceThreadStep,
} from "@/lib/email/sequence-thread";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  SCHEDULED_SEND_MAX_ATTEMPTS,
  classifyScheduledSendError,
  nextRetryAtIso,
  nextUtcMidnightIso,
  normalizeSendGapSeconds,
} from "@/lib/email/scheduled-send-failure";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/firestore/tenant-write";

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
    bcc: data.bcc ? String(data.bcc) : undefined,
    subject: String(data.subject ?? ""),
    body: String(data.body ?? data.text ?? ""),
    text: String(data.text ?? data.body ?? ""),
    html: String(data.html ?? ""),
    attachments,
    scheduledAt: String(data.scheduledAt ?? ""),
    status: (String(data.status ?? "pending") as ScheduledEmailStatus) || "pending",
    createdAt: String(data.createdAt ?? ""),
    scheduledByUserId:
      typeof data.scheduledByUserId === "string" && data.scheduledByUserId.trim()
        ? data.scheduledByUserId.trim()
        : undefined,
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
    attempts: Number.isFinite(Number(data.attempts)) ? Math.max(0, Number(data.attempts)) : undefined,
    nextRetryAt:
      typeof data.nextRetryAt === "string" && data.nextRetryAt.trim()
        ? data.nextRetryAt.trim()
        : undefined,
    failureKind:
      data.failureKind === "transient" ||
      data.failureKind === "permanent" ||
      data.failureKind === "quota"
        ? data.failureKind
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
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: unknown;
  scheduledAt: string;
  /** Authenticated workspace user who queued the email. */
  scheduledByUserId?: string;
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
    bcc: input.bcc ?? "",
    subject: input.subject,
    body: input.text,
    text: input.text,
    html: input.html,
    attachments: serializeOutboundAttachments(parsedAttachments),
    scheduledAt: scheduledDate.toISOString(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...(input.scheduledByUserId?.trim()
      ? { scheduledByUserId: input.scheduledByUserId.trim() }
      : {}),
    ...(followupId ? { followupId } : {}),
    ...(leadId ? { leadId } : {}),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.referenceIds?.length ? { referenceIds: input.referenceIds.slice(-50) } : {}),
  });

  return { ok: true, id: ref.id };
}

async function resolveScheduledEmailDoc(input: {
  organizationId: string;
  uid: string;
  id: string;
  /** Extra member mailbox roots to try (e.g. followup owner). */
  fallbackUids?: string[];
}): Promise<
  | { found: true; ref: DocumentReference; data: Record<string, unknown> }
  | { found: false }
  | { error: string }
> {
  const tried = new Set<string>();
  const candidates = [input.uid, ...(input.fallbackUids ?? [])]
    .map((u) => u.trim())
    .filter(Boolean);

  for (const memberUid of candidates) {
    if (tried.has(memberUid)) continue;
    tried.add(memberUid);
    const ref = scheduledRef(input.organizationId, memberUid, input.id);
    if (!ref) return { error: "Database not configured" };
    const snap = await ref.get();
    if (snap.exists) {
      return { found: true, ref, data: snap.data() as Record<string, unknown> };
    }
  }
  return { found: false };
}

export async function cancelScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  id: string;
  reason?: string;
  /** Linked followup — used to try owner mailbox and to unlink orphans. */
  followupId?: string;
  /** Extra member mailbox roots to try when the doc is not under `uid`. */
  fallbackUids?: string[];
}): Promise<{ ok: true } | { error: string }> {
  const followupIdHint = input.followupId?.trim() || "";
  const fallbackUids = [...(input.fallbackUids ?? [])];

  if (followupIdHint) {
    const db = getAdminDb();
    if (db) {
      try {
        const fuSnap = await db.collection(COLLECTIONS.followups).doc(followupIdHint).get();
        if (fuSnap.exists) {
          const ownerId = String(
            (fuSnap.data() as Record<string, unknown>).ownerId ?? "",
          ).trim();
          if (ownerId) fallbackUids.push(ownerId);
        }
      } catch {
        /* ignore — cancel still proceeds */
      }
    }
  }

  const resolved = await resolveScheduledEmailDoc({
    organizationId: input.organizationId,
    uid: input.uid,
    id: input.id,
    fallbackUids,
  });
  if ("error" in resolved) return { error: resolved.error };

  const now = new Date().toISOString();
  const reason = (input.reason?.trim() || "Cancelled by user").slice(0, 500);

  // Orphan schedule link on the followup: queue doc already gone — unlink and succeed.
  if (!resolved.found) {
    if (followupIdHint) {
      await updateFollowupDeliveryState(followupIdHint, {
        deliveryStatus: "cancelled",
        cancelledAt: now,
        cancelReason: reason,
        clearSchedule: true,
      });
    }
    return { ok: true };
  }

  const { ref, data } = resolved;
  const followupId =
    (typeof data.followupId === "string" ? data.followupId.trim() : "") ||
    followupIdHint;

  // Already sent / cancelled / failed — clear any leftover followup link and succeed.
  if (String(data.status) !== "pending") {
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

  await ref.update({
    status: "cancelled",
    cancelledAt: now,
    cancelReason: reason,
    updatedAt: now,
  });
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
    deliveryStatus: "sent" | "failed" | "cancelled" | "needs_retry" | "scheduled";
    sentAt?: string;
    sentMessageId?: string;
    failedAt?: string;
    cancelledAt?: string;
    deliveryError?: string;
    cancelReason?: string;
    completedAt?: string;
    clearSchedule?: boolean;
    keepSchedule?: boolean;
    deliveryAttempts?: number;
    nextRetryAt?: string | null;
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
    if (input.deliveryAttempts != null) patch.deliveryAttempts = input.deliveryAttempts;
    if (input.nextRetryAt === null) patch.nextRetryAt = FieldValue.delete();
    else if (input.nextRetryAt) patch.nextRetryAt = input.nextRetryAt;
    if (input.clearSchedule) {
      patch.scheduledEmailId = FieldValue.delete();
      patch.emailScheduledAt = FieldValue.delete();
    }
    if (input.keepSchedule && input.nextRetryAt) {
      patch.emailScheduledAt = input.nextRetryAt;
    }
    await ref.update(patch);
    return typeof current.planId === "string" ? current.planId.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

async function notifyFollowupOwnerOfDeliveryFailure(input: {
  organizationId: string;
  followupId: string;
  leadId?: string;
  error: string;
  kind: "failed" | "needs_retry";
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(input.followupId).get();
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    const ownerId = typeof data.ownerId === "string" ? data.ownerId.trim() : "";
    if (!ownerId) return;
    const title = typeof data.title === "string" ? data.title.trim() : "Sequence email";
    const leadId =
      input.leadId?.trim() ||
      (typeof data.leadId === "string" ? data.leadId.trim() : "");
    const href = leadId ? `/leads/${leadId}` : "/followups";
    const prefix =
      input.kind === "needs_retry" ? "Email send will retry" : "Email send failed";
    await createUserNotificationServer({
      organizationId: input.organizationId,
      recipientId: ownerId,
      actorId: "system",
      kind: "followup",
      message: `${prefix}: ${title} - ${input.error.slice(0, 180)}`,
      target: title,
      targetHref: href,
      entityType: "followup",
      entityId: input.followupId,
      id: `un-email-${input.kind}-${input.followupId}-${Math.floor(Date.now() / 3_600_000)}`,
    });
  } catch {
    /* Notifications are best-effort. */
  }
}

async function recordScheduledEmailSentTimeline(input: {
  organizationId: string;
  mailboxOwnerUid: string;
  scheduledByUserId?: string;
  leadId: string;
  subject: string;
  messageId?: string;
  followupId?: string;
  mailboxId: string;
}): Promise<void> {
  const db = getAdminDb();
  if (!db || !input.leadId.trim()) return;
  try {
    const teId = `te-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    let leadOwnerId = input.mailboxOwnerUid;
    try {
      const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
      if (leadSnap.exists) {
        const owner = (leadSnap.data() as Record<string, unknown>).ownerId;
        if (typeof owner === "string" && owner.trim()) leadOwnerId = owner.trim();
      }
    } catch {
      /* keep mailbox owner as the visibility fallback */
    }
    // Credit the person who queued the outreach. Legacy queued rows do not have
    // scheduledByUserId, so fall back to the lead owner rather than the mailbox admin.
    const actorId = input.scheduledByUserId?.trim() || leadOwnerId || input.mailboxOwnerUid;
    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
    await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
      stampForCreate(
        input.organizationId,
        {
          leadId: input.leadId,
          leadOwnerId,
          leadOwnerManagerIds,
          type: "email_sent",
          actorId,
          summary: `Email sent: ${input.subject.trim() || "(no subject)"}`,
          payload: {
            source: "scheduled",
            mailboxId: input.mailboxId,
            ...(input.scheduledByUserId?.trim()
              ? { scheduledByUserId: input.scheduledByUserId.trim() }
              : {}),
            ...(input.mailboxOwnerUid !== actorId
              ? { mailboxOwnerUid: input.mailboxOwnerUid }
              : {}),
            ...(input.messageId ? { messageId: input.messageId } : {}),
            ...(input.followupId ? { followupId: input.followupId } : {}),
          },
          createdAt: now,
        },
        actorId,
      ),
    );
    await db
      .collection(COLLECTIONS.leads)
      .doc(input.leadId)
      .update({
        lastActivityAt: now,
        updatedAt: now,
      })
      .catch(() => undefined);
  } catch {
    /* Timeline is best-effort; CRM delivery state remains authoritative. */
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
  runContext?: {
    lastSentAtByMailbox: Map<string, number>;
    /** When true, never sleep for send gaps — requeue instead (local process-due). */
    requeueSendGaps?: boolean;
  },
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
        failureKind: cancelled ? "permanent" : "permanent",
        ...(cancelled ? { cancelledAt: now, cancelReason: contactPolicy.error } : {}),
        updatedAt: now,
        processingAt: FieldValue.delete(),
        processingClaimId: FieldValue.delete(),
      });
      if (followupIdEarly) {
        await updateFollowupDeliveryState(followupIdEarly, {
          deliveryStatus: cancelled ? "cancelled" : "failed",
          ...(cancelled
            ? { cancelledAt: now, cancelReason: contactPolicy.error, clearSchedule: true }
            : { failedAt: now, deliveryError: contactPolicy.error }),
          nextRetryAt: null,
        });
        if (!cancelled) {
          await notifyFollowupOwnerOfDeliveryFailure({
            organizationId,
            followupId: followupIdEarly,
            leadId,
            error: contactPolicy.error,
            kind: "failed",
          });
        }
      }
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
      failureKind: "permanent",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: "Mailbox no longer exists.",
        nextRetryAt: null,
      });
      await notifyFollowupOwnerOfDeliveryFailure({
        organizationId,
        followupId: followupIdEarly,
        leadId,
        error: "Mailbox no longer exists.",
        kind: "failed",
      });
    }
    return "failed";
  }

  const gapSeconds = normalizeSendGapSeconds(mailbox.sendGapSeconds);
  if (gapSeconds > 0) {
    const mailboxKey = `${organizationId}/${uid}/${mailboxId}`;
    let lastMs = runContext?.lastSentAtByMailbox.get(mailboxKey);
    if (lastMs == null) {
      const persisted = await getMailboxLastSentAtServer({ organizationId, uid, mailboxId });
      lastMs = persisted ? new Date(persisted).getTime() : undefined;
    }
    if (lastMs != null && Number.isFinite(lastMs)) {
      const earliest = lastMs + gapSeconds * 1000;
      const waitMs = earliest - Date.now();
      if (waitMs > 0) {
        // Local/dev process-due must not block the Next.js process for up to 25s per gap.
        const shouldSleep = !runContext?.requeueSendGaps && waitMs <= 25_000;
        if (shouldSleep) {
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          const retryAt = new Date(earliest).toISOString();
          await docRef.update({
            status: "pending",
            scheduledAt: retryAt,
            updatedAt: new Date().toISOString(),
            processingAt: FieldValue.delete(),
            processingClaimId: FieldValue.delete(),
          });
          if (followupIdEarly) {
            await updateFollowupDeliveryState(followupIdEarly, {
              deliveryStatus: "scheduled",
              keepSchedule: true,
              nextRetryAt: retryAt,
            });
          }
          return "skipped";
        }
      }
    }
  }

  const quota = await assertMailboxDailySendQuotaServer({
    organizationId,
    uid,
    mailboxId,
    dailySendLimit: mailbox.dailySendLimit,
  });
  if (!quota.ok) {
    const now = new Date().toISOString();
    const deferAt = nextUtcMidnightIso(new Date(now));
    await docRef.update({
      status: "pending",
      scheduledAt: deferAt,
      error: quota.error,
      failureKind: "quota",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "needs_retry",
        failedAt: now,
        deliveryError: quota.error,
        keepSchedule: true,
        nextRetryAt: deferAt,
      });
    }
    return "skipped";
  }

  const parsedAttachments = parseOutboundAttachments(data.attachments);
  if ("error" in parsedAttachments) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: parsedAttachments.error,
      failureKind: "permanent",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: parsedAttachments.error,
        nextRetryAt: null,
      });
      await notifyFollowupOwnerOfDeliveryFailure({
        organizationId,
        followupId: followupIdEarly,
        leadId,
        error: parsedAttachments.error,
        kind: "failed",
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
    bcc: String(data.bcc ?? "") || undefined,
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
      failureKind: FieldValue.delete(),
      nextRetryAt: FieldValue.delete(),
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
        nextRetryAt: null,
      });
      if (planId) await completePlanWhenAllStepsDone(planId, now);
    }
    if (leadId) {
      const scheduledByUserId =
        typeof data.scheduledByUserId === "string" && data.scheduledByUserId.trim()
          ? data.scheduledByUserId.trim()
          : undefined;
      await recordScheduledEmailSentTimeline({
        organizationId,
        mailboxOwnerUid: uid,
        scheduledByUserId,
        leadId,
        subject,
        messageId,
        followupId: followupId || undefined,
        mailboxId,
      });
      await persistOutboundLeadMailServer({
        organizationId,
        leadId,
        mailboxId,
        mailboxOwnerUid: uid,
        from: String(data.from ?? ""),
        to: String(data.to ?? ""),
        cc: String(data.cc ?? "") || undefined,
        bcc: String(data.bcc ?? "") || undefined,
        replyTo: String(data.replyTo ?? "") || undefined,
        subject,
        bodyText: String(data.text ?? data.body ?? ""),
        bodyHtml: String(data.html ?? "") || undefined,
        sentAt: now,
        messageId,
        inReplyTo,
        referenceIds,
        source: followupId ? "crm_followup" : "scheduled",
      });
      try {
        await resolvePendingReplyActionOnOutboundServer({
          organizationId,
          leadId,
          decidedBy: scheduledByUserId || uid,
          messageId,
          sentAt: now,
        });
      } catch {
        /* Delivery succeeded; reply-intelligence cleanup is best-effort. */
      }
    }
    try {
      await incrementMailboxSendCountServer({ organizationId, uid, mailboxId });
    } catch {
      /* Delivery is authoritative; quota accounting can recover independently. */
    }
    if (runContext) {
      runContext.lastSentAtByMailbox.set(`${organizationId}/${uid}/${mailboxId}`, Date.now());
    }
    return "sent";
  }

  const attempts = Math.max(0, Number(data.attempts ?? 0)) + 1;
  const kind = classifyScheduledSendError(result.error);
  const errorText = result.error.slice(0, 500);

  if (kind === "transient" && attempts < SCHEDULED_SEND_MAX_ATTEMPTS) {
    const retryAt = nextRetryAtIso(attempts);
    await docRef.update({
      status: "pending",
      scheduledAt: retryAt,
      attempts,
      nextRetryAt: retryAt,
      error: errorText,
      failureKind: "transient",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupIdEarly) {
      await updateFollowupDeliveryState(followupIdEarly, {
        deliveryStatus: "needs_retry",
        failedAt: now,
        deliveryError: errorText,
        deliveryAttempts: attempts,
        keepSchedule: true,
        nextRetryAt: retryAt,
      });
      await notifyFollowupOwnerOfDeliveryFailure({
        organizationId,
        followupId: followupIdEarly,
        leadId,
        error: `${errorText} (retry ${attempts}/${SCHEDULED_SEND_MAX_ATTEMPTS})`,
        kind: "needs_retry",
      });
    }
    return "skipped";
  }

  await docRef.update({
    status: "failed",
    error: errorText,
    attempts,
    failureKind: kind === "quota" ? "quota" : "permanent",
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
    nextRetryAt: FieldValue.delete(),
  });
  if (followupIdEarly) {
    await updateFollowupDeliveryState(followupIdEarly, {
      deliveryStatus: "failed",
      failedAt: now,
      deliveryError: errorText,
      deliveryAttempts: attempts,
      nextRetryAt: null,
    });
    await notifyFollowupOwnerOfDeliveryFailure({
      organizationId,
      followupId: followupIdEarly,
      leadId,
      error: errorText,
      kind: "failed",
    });
  }
  return "failed";
}

async function processScheduledSnap(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> }>,
  opts?: { requeueSendGaps?: boolean },
): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const runContext = {
    lastSentAtByMailbox: new Map<string, number>(),
    requeueSendGaps: Boolean(opts?.requeueSendGaps),
  };

  for (const doc of docs) {
    const claimed = await claimScheduledDoc(doc.ref);
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      const outcome = await sendScheduledDoc(doc.ref, claimed, runContext);
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
 * Production cron uses processDueScheduledEmailsServer (collection group) with the same claim path.
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
    // Never sleep on send gaps in the browser-driven local poller.
    { requeueSendGaps: true },
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

  return processScheduledSnap(
    snap.docs.map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    })),
  );
}

/** Manual retry: re-queue a failed (or exhausted) scheduled email for immediate send. */
export async function retryScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  id: string;
}): Promise<{ ok: true; scheduledAt: string } | { error: string }> {
  const ref = scheduledRef(input.organizationId, input.uid, input.id);
  if (!ref) return { error: "Database not configured" };

  const snap = await ref.get();
  if (!snap.exists) return { error: "Scheduled email not found." };
  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status ?? "");
  if (status !== "failed" && status !== "pending") {
    return { error: "Only failed or pending scheduled emails can be retried." };
  }

  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  const now = new Date().toISOString();
  await ref.update({
    status: "pending",
    scheduledAt,
    error: null,
    failureKind: FieldValue.delete(),
    nextRetryAt: scheduledAt,
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
  });

  const followupId = typeof data.followupId === "string" ? data.followupId.trim() : "";
  if (followupId) {
    await updateFollowupDeliveryState(followupId, {
      deliveryStatus: "scheduled",
      keepSchedule: true,
      nextRetryAt: scheduledAt,
    });
    // Re-link schedule fields if they were cleared on permanent fail.
    const db = getAdminDb();
    if (db) {
      await db
        .collection(COLLECTIONS.followups)
        .doc(followupId)
        .update({
          scheduledEmailId: input.id,
          emailScheduledAt: scheduledAt,
          deliveryStatus: "scheduled",
          deliveryError: FieldValue.delete(),
          failedAt: FieldValue.delete(),
          updatedAt: now,
        })
        .catch(() => undefined);
    }
  }

  return { ok: true, scheduledAt };
}
