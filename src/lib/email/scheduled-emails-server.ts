import type { DocumentReference, DocumentSnapshot } from "@/lib/db/document-shim/shim-firestore";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { coerceIsoInstant, coerceInstantMs } from "@/lib/db/document-shim/timestamp";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { EmailMailboxSettings, ScheduledEmail, ScheduledEmailStatus } from "@/lib/email-account-types";
import { isScheduledDocDue } from "@/lib/email/scheduled-due";
import {
  FOLLOWUP_MISSING_STOP_REASON,
  scheduledFollowupStopReason,
} from "@/lib/email/scheduled-followup-stop";
import {
  parseOutboundAttachments,
  serializeOutboundAttachments,
  type OutboundAttachmentPayload,
} from "@/lib/email/outbound-attachments";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import {
  listMailboxesForMemberServer,
  findMailboxHostInOrgServer,
} from "@/lib/email/mailbox-profiles-server";
import {
  reserveMailboxDailySendServer,
  releaseMailboxDailySendServer,
  releaseMailboxScheduleSlotServer,
  getMailboxLastSentAtServer,
} from "@/lib/email/mailbox-send-quota-server";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { outboundAttachmentsToLeadMail } from "@/lib/email/lead-mail-attachments";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";
import {
  resolveSequenceThreadContext,
  SEQUENCE_WAIT_FOR_PRIOR_MAX_MS,
  type SequenceThreadAnchor,
  type SequenceThreadStep,
} from "@/lib/email/sequence-thread";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  SCHEDULED_SEND_MAX_ATTEMPTS,
  classifyScheduledSendError,
  nextRetryAtIso,
  nextZonedDayStartIso,
  normalizeSendGapSeconds,
} from "@/lib/email/scheduled-send-failure";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/documents/tenant-write";
import { incrementOrgSendLedgerServer } from "@/lib/email/org-send-ledger-server";
import { isQueueHeavyJobsV1Enabled, isScheduledEmailPgV1Enabled } from "@/lib/queue/flags";
import { enqueueScheduledEmailJob } from "@/lib/queue/enqueue";

const SCHEDULED_COLLECTION = "scheduledEmails";
/** Keep lease long enough for SMTP+IMAP; reclaim only truly abandoned claims. */
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
/** If a prior sequence step never finishes, stop blocking forever and send as root. */
const WAIT_FOR_PRIOR_MAX_MS = SEQUENCE_WAIT_FOR_PRIOR_MAX_MS;

export type ScheduledSkipReason =
  | "wait_for_prior"
  | "send_gap"
  | "quota"
  | "claim_refused"
  | "exception"
  | "deadline"
  | "followup_stopped"
  | "contact_policy"
  | "suppressed"
  | "other";

export type ScheduledFlushRowResult = {
  id: string;
  outcome: "sent" | "failed" | "skipped";
  reason?: ScheduledSkipReason;
  blockedByFollowupId?: string;
  detail?: string;
};

type SendDocResult = {
  outcome: "sent" | "failed" | "skipped";
  reason?: ScheduledSkipReason;
  blockedByFollowupId?: string;
  detail?: string;
};

function emptySkipReasons(): Record<ScheduledSkipReason, number> {
  return {
    wait_for_prior: 0,
    send_gap: 0,
    quota: 0,
    claim_refused: 0,
    exception: 0,
    deadline: 0,
    followup_stopped: 0,
    contact_policy: 0,
    suppressed: 0,
    other: 0,
  };
}

/** Ask the worker to flush due mail around `scheduledAt` (best-effort). */
async function nudgeScheduledEmailWorker(scheduledAt: Date | string): Promise<void> {
  if (!isQueueHeavyJobsV1Enabled()) return;
  const when = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) return;
  const delayMs = Math.max(0, when.getTime() - Date.now());
  // Small buffer so the row is visible as due when the tick runs.
  await enqueueScheduledEmailJob({ delayMs: delayMs + 2_000 }).catch(() => null);
}

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
    uid: typeof data.uid === "string" && data.uid.trim() ? data.uid.trim() : undefined,
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
    scheduledAt: coerceIsoInstant(data.scheduledAt),
    status: (String(data.status ?? "pending") as ScheduledEmailStatus) || "pending",
    createdAt: coerceIsoInstant(data.createdAt) || String(data.createdAt ?? ""),
    scheduledByUserId:
      typeof data.scheduledByUserId === "string" && data.scheduledByUserId.trim()
        ? data.scheduledByUserId.trim()
        : undefined,
    sentAt: data.sentAt ? coerceIsoInstant(data.sentAt) : undefined,
    messageId:
      typeof data.messageId === "string" && data.messageId.trim()
        ? data.messageId.trim()
        : undefined,
    error: data.error ? String(data.error) : undefined,
    cancelledAt: data.cancelledAt ? coerceIsoInstant(data.cancelledAt) : undefined,
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
    forceNewThread: data.forceNewThread === true ? true : undefined,
    attempts: Number.isFinite(Number(data.attempts)) ? Math.max(0, Number(data.attempts)) : undefined,
    nextRetryAt: data.nextRetryAt ? coerceIsoInstant(data.nextRetryAt) : undefined,
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
  if (isScheduledEmailPgV1Enabled()) {
    const { listScheduledEmailsForMemberPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return listScheduledEmailsForMemberPgServer(input);
  }
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
  /** Start a new sequence thread (ignore prior non-fresh sent steps). */
  forceNewThread?: boolean;
}): Promise<{ ok: true; id: string } | { error: string }> {
  if (isScheduledEmailPgV1Enabled()) {
    const { createScheduledEmailPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return createScheduledEmailPgServer(input);
  }
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
  const reserved = await incrementOrgSendLedgerServer({
    organizationId: input.organizationId,
    scheduledAt: scheduledDate,
    delta: 1,
  });
  if (!reserved.ok) {
    return { error: reserved.error };
  }

  try {
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
      ...(input.forceNewThread ? { forceNewThread: true } : {}),
    });
  } catch {
    await incrementOrgSendLedgerServer({
      organizationId: input.organizationId,
      scheduledAt: scheduledDate,
      delta: -1,
    });
    return { error: "Could not create scheduled email." };
  }

  if (followupId) {
    const db = getAdminDb();
    if (db) {
      try {
        const followupRef = db.collection(COLLECTIONS.followups).doc(followupId);
        await followupRef.update({
          scheduledEmailId: ref.id,
          emailScheduledAt: scheduledDate.toISOString(),
          deliveryStatus: "scheduled",
          mailboxId: input.mailboxId,
          fromEmail: input.from.trim(),
          toEmail: input.to.trim(),
          mailboxOwnerUid: input.uid,
          // Scheduling is an explicit send intent — clear stale stop markers that would
          // auto-cancel on process-due (empty-string or leftover pause/complete).
          pausedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          failedAt: FieldValue.delete(),
          cancelledAt: FieldValue.delete(),
          deliveryError: FieldValue.delete(),
          cancelReason: FieldValue.delete(),
          ...(input.forceNewThread ? { freshThread: true } : {}),
          updatedAt: now,
        });
        // If the plan was reply/bounce-paused, resuming schedule means send again.
        const followupSnap = await followupRef.get();
        const planId =
          followupSnap.exists && typeof followupSnap.data()?.planId === "string"
            ? String(followupSnap.data()?.planId).trim()
            : "";
        if (planId) {
          const planRef = db.collection(COLLECTIONS.followupPlans).doc(planId);
          const planSnap = await planRef.get();
          if (planSnap.exists) {
            const planStatus = String((planSnap.data() as Record<string, unknown>).status ?? "");
            if (planStatus === "paused") {
              await planRef.update({
                status: "active",
                pausedAt: FieldValue.delete(),
                pausedReason: FieldValue.delete(),
                updatedAt: now,
              });
            }
          }
        }
      } catch {
        /* Client persistFollowupEmailSchedule is the primary path; this is best-effort. */
      }
    }
  }

  await nudgeScheduledEmailWorker(scheduledDate);

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
  if (isScheduledEmailPgV1Enabled()) {
    const { cancelScheduledEmailPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return cancelScheduledEmailPgServer(input);
  }
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
  const scheduledAtRaw = data.scheduledAt;
  if (typeof scheduledAtRaw === "string" && scheduledAtRaw.trim()) {
    await incrementOrgSendLedgerServer({
      organizationId: input.organizationId,
      scheduledAt: scheduledAtRaw,
      delta: -1,
    });
  }
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
    mailboxId?: string;
    fromEmail?: string;
    toEmail?: string;
    mailboxOwnerUid?: string;
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
    if (input.mailboxId?.trim()) patch.mailboxId = input.mailboxId.trim();
    if (input.fromEmail?.trim()) patch.fromEmail = input.fromEmail.trim();
    if (input.toEmail?.trim()) patch.toEmail = input.toEmail.trim();
    if (input.mailboxOwnerUid?.trim()) patch.mailboxOwnerUid = input.mailboxOwnerUid.trim();
    if (input.clearSchedule) {
      // Keep mailboxId / fromEmail / toEmail so resume can prefer the same sender.
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
    freshThread: data.freshThread === true ? true : undefined,
  };
}

/** Conversation a regenerated plan continues, when it was built from a reply. */
function planThreadAnchor(
  data: Record<string, unknown> | undefined,
): SequenceThreadAnchor | undefined {
  const raw = data?.threadAnchor;
  if (!raw || typeof raw !== "object") return undefined;
  const anchor = raw as Record<string, unknown>;
  const inReplyTo = typeof anchor.inReplyTo === "string" ? anchor.inReplyTo.trim() : "";
  if (!inReplyTo) return undefined;
  return {
    inReplyTo,
    referenceIds: Array.isArray(anchor.referenceIds)
      ? anchor.referenceIds.map((id) => String(id)).filter(Boolean)
      : undefined,
    subject: typeof anchor.subject === "string" ? anchor.subject : undefined,
  };
}

/**
 * Build In-Reply-To / References from earlier sent steps in the same plan.
 * Returns null when this mail already has explicit reply headers (e.g. schedule-from-thread).
 */
async function resolveSequenceThreadingForFollowup(input: {
  followupId: string;
  existingInReplyTo?: string;
  forceNewThread?: boolean;
}): Promise<
  | { kind: "use_existing" }
  | { kind: "root" }
  | {
      kind: "wait_for_prior";
      blockedBy: { followupId: string; deliveryStatus?: string };
    }
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
    if (input.forceNewThread && !current.freshThread) {
      current.freshThread = true;
    }
    const siblings = siblingsSnap.docs.map((doc) =>
      followupDocToThreadStep(doc.id, doc.data() as Record<string, unknown>),
    );
    const planSnap = await db.collection(COLLECTIONS.followupPlans).doc(planId).get();
    const anchor = planThreadAnchor(planSnap.data() as Record<string, unknown> | undefined);
    return resolveSequenceThreadContext(current, siblings, anchor);
  } catch {
    return { kind: "none" };
  }
}

async function releaseScheduledClaim(
  docRef: DocumentReference,
  patch?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "pending",
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
    ...(patch ?? {}),
  });
}

/** Path: organizations/{orgId}/members/{uid}/scheduledEmails/{id} */
function ownerFromScheduledRef(docRef: DocumentReference): {
  organizationId?: string;
  uid?: string;
} {
  const parts = docRef.path.split("/").filter(Boolean);
  const orgIdx = parts.indexOf(COLLECTIONS.organizations);
  const memIdx = parts.indexOf(ORG_SUBCOLLECTIONS.members);
  const organizationId =
    orgIdx >= 0 && parts[orgIdx + 1] ? String(parts[orgIdx + 1]) : undefined;
  const uid = memIdx >= 0 && parts[memIdx + 1] ? String(parts[memIdx + 1]) : undefined;
  return { organizationId, uid };
}

async function failScheduledDocPermanent(
  docRef: DocumentReference,
  error: string,
): Promise<SendDocResult> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "failed",
    error,
    failureKind: "permanent",
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
    waitingForPriorSince: FieldValue.delete(),
    blockedByFollowupId: FieldValue.delete(),
    lastSkipReason: FieldValue.delete(),
  });
  return { outcome: "failed" };
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
): Promise<SendDocResult> {
  const now = new Date().toISOString();
  await docRef.update({
    status: "cancelled",
    error: `Cancelled: ${reason}.`,
    cancelledAt: now,
    cancelReason: reason,
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
    lastSkipReason: "followup_stopped",
    waitingForPriorSince: FieldValue.delete(),
    blockedByFollowupId: FieldValue.delete(),
  });
  await updateFollowupDeliveryState(followupId, {
    deliveryStatus: "cancelled",
    cancelledAt: now,
    cancelReason: reason,
    clearSchedule: true,
  });
  return { outcome: "skipped", reason: "followup_stopped", detail: reason };
}

/** Skip send when the linked followup (or its plan) was paused/completed after a reply. */
async function shouldStopScheduledFollowupEmail(
  followupId: string,
): Promise<string | undefined> {
  const db = getAdminDb();
  if (!db) return undefined;
  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(followupId).get();
    if (!snap.exists) {
      return scheduledFollowupStopReason({ followupExists: false });
    }
    const f = snap.data() as Record<string, unknown>;
    const planId = typeof f.planId === "string" ? f.planId.trim() : "";
    let planStatus: string | undefined;
    if (planId) {
      const planSnap = await db.collection(COLLECTIONS.followupPlans).doc(planId).get();
      if (planSnap.exists) {
        planStatus = String((planSnap.data() as Record<string, unknown>).status ?? "");
      }
    }
    return scheduledFollowupStopReason({
      followupExists: true,
      pausedAt: f.pausedAt,
      completedAt: f.completedAt,
      planStatus,
    });
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
    const processingAtMs = coerceInstantMs(data.processingAt);
    const staleProcessing =
      status === "processing" &&
      (processingAtMs == null || Date.now() - processingAtMs >= PROCESSING_LEASE_MS);
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
): Promise<SendDocResult> {
  const fromPath = ownerFromScheduledRef(docRef);
  const organizationId = String(data.organizationId ?? fromPath.organizationId ?? "");
  const uid = String(data.uid ?? fromPath.uid ?? "");
  const mailboxId = String(data.mailboxId ?? "");

  console.log(`[scheduled-send] sendScheduledDoc starting for docId: "${docRef.id}", path: "${docRef.path}", org: "${organizationId}", docUid: "${uid}", mailboxId: "${mailboxId}", status: "${data.status}", scheduledAt: "${coerceIsoInstant(data.scheduledAt) || String(data.scheduledAt ?? "")}"`);

  if (!organizationId || !uid || !mailboxId) {
    console.error(`[scheduled-send] Permanent failure: scheduled doc "${docRef.id}" is missing organizationId ("${organizationId}"), uid ("${uid}"), or mailboxId ("${mailboxId}")`);
    return failScheduledDocPermanent(
      docRef,
      "Scheduled email is missing organization, owner, or mailbox.",
    );
  }

  let followupIdEarly =
    typeof data.followupId === "string" ? data.followupId.trim() : "";
  const initialStopReason = followupIdEarly
    ? await shouldStopScheduledFollowupEmail(followupIdEarly)
    : undefined;
  if (followupIdEarly && initialStopReason === FOLLOWUP_MISSING_STOP_REASON) {
    // Orphan link: scheduled row has followupId but the followup doc is gone
    // (e.g. never persisted while client sync was off). Pause/complete still cancel;
    // only "missing" sends as standalone so due mail is not auto-dropped.
    console.warn(
      `[scheduled-send] Orphan followupId "${followupIdEarly}" on "${docRef.id}" (${FOLLOWUP_MISSING_STOP_REASON}) — sending as standalone`,
    );
    const nowIso = new Date().toISOString();
    await docRef.update({
      followupId: FieldValue.delete(),
      updatedAt: nowIso,
    });
    followupIdEarly = "";
  } else if (followupIdEarly && initialStopReason) {
    console.log(`[scheduled-send] Follow-up "${followupIdEarly}" is stopped (${initialStopReason}), cancelling doc "${docRef.id}"`);
    return cancelDueToFollowupStop(docRef, followupIdEarly, initialStopReason);
  }
  const leadId = typeof data.leadId === "string" ? data.leadId.trim() : "";
  if (leadId) {
    const contactPolicy = await assertLeadContactAllowedServer({ organizationId, leadId });
    if (!contactPolicy.ok) {
      console.warn(`[scheduled-send] Lead contact policy disallowed for lead "${leadId}" on doc "${docRef.id}": ${contactPolicy.error}`);
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
        lastSkipReason: cancelled ? "contact_policy" : FieldValue.delete(),
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
      return cancelled
        ? { outcome: "skipped", reason: "contact_policy", detail: contactPolicy.error }
        : { outcome: "failed" };
    }
  }

  let mailboxOwnerUid =
    (typeof data.mailboxOwnerUid === "string" && data.mailboxOwnerUid.trim()) ||
    (typeof data.dataOwnerUid === "string" && data.dataOwnerUid.trim()) ||
    uid;

  console.log(`[scheduled-send] Resolving mailbox "${mailboxId}" starting with mailboxOwnerUid: "${mailboxOwnerUid}" (docUid: "${uid}")`);

  let mailbox: EmailMailboxSettings | undefined;
  if (mailboxOwnerUid !== uid) {
    const hostMailboxes = await listMailboxesForMemberServer({ organizationId, uid: mailboxOwnerUid });
    mailbox = hostMailboxes.find((m) => m.id === mailboxId);
    if (mailbox) {
      console.log(`[scheduled-send] Found mailbox in initial host mailbox list under hostUid "${mailboxOwnerUid}"`);
    }
  }
  if (!mailbox) {
    const memberMailboxes = await listMailboxesForMemberServer({ organizationId, uid });
    mailbox = memberMailboxes.find((m) => m.id === mailboxId);
    if (mailbox) {
      console.log(`[scheduled-send] Found mailbox in doc owner's list under uid "${uid}"`);
    }
  }
  if (!mailbox) {
    console.log(`[scheduled-send] Mailbox "${mailboxId}" not in member profile, searching org via findMailboxHostInOrgServer...`);
    const hostInfo = await findMailboxHostInOrgServer({ organizationId, mailboxId });
    if (hostInfo) {
      mailbox = hostInfo.mailbox;
      mailboxOwnerUid = hostInfo.uid;
      console.log(`[scheduled-send] findMailboxHostInOrgServer located hostUid "${mailboxOwnerUid}" with mailbox "${mailbox.emailAddress}"`);
    }
  }

  if (!mailbox) {
    console.error(`[scheduled-send] Mailbox "${mailboxId}" could not be found anywhere in organization "${organizationId}". Marking doc "${docRef.id}" failed.`);
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
    return { outcome: "failed" };
  }

  console.log(`[scheduled-send] Mailbox verified: "${mailbox.emailAddress}" (host: "${mailbox.smtp.host}:${mailbox.smtp.port}", user: "${mailbox.smtp.user ? "configured" : "empty"}", owner: "${mailboxOwnerUid}")`);

  const gapSeconds = normalizeSendGapSeconds(mailbox.sendGapSeconds);
  if (gapSeconds > 0) {
    const mailboxKey = `${organizationId}/${mailboxOwnerUid}/${mailboxId}`;
    let lastMs = runContext?.lastSentAtByMailbox.get(mailboxKey);
    if (lastMs == null) {
      const persisted = await getMailboxLastSentAtServer({
        organizationId,
        uid: mailboxOwnerUid,
        mailboxId,
      });
      lastMs = persisted ? coerceInstantMs(persisted) ?? undefined : undefined;
    }
    if (lastMs != null && Number.isFinite(lastMs)) {
      const earliest = lastMs + gapSeconds * 1000;
      const waitMs = earliest - Date.now();
      if (waitMs > 0) {
        // Local/dev process-due must not block the Next.js process for up to 25s per gap.
        const shouldSleep = !runContext?.requeueSendGaps && waitMs <= 25_000;
        if (shouldSleep) {
          console.log(`[scheduled-send] Send gap active: sleeping ${waitMs}ms before sending from mailbox "${mailboxId}"`);
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          // Keep user-visible scheduledAt stable; defer readiness via notBeforeAt.
          const retryAt = new Date(earliest).toISOString();
          const nowIso = new Date().toISOString();
          console.log(`[scheduled-send] Send gap active: deferring doc "${docRef.id}" until "${retryAt}"`);
          await docRef.update({
            status: "pending",
            notBeforeAt: retryAt,
            nextRetryAt: retryAt,
            lastSkipReason: "send_gap",
            lastSkipAt: nowIso,
            updatedAt: nowIso,
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
          return { outcome: "skipped", reason: "send_gap", detail: `notBeforeAt=${retryAt}` };
        }
      }
    }
  }

  const quota = await reserveMailboxDailySendServer({
    organizationId,
    uid: mailboxOwnerUid,
    mailboxId,
    dailySendLimit: mailbox.dailySendLimit,
  });
  if (!quota.ok) {
    const now = new Date().toISOString();
    const orgTimeZone = await getOrgTimezoneServer(organizationId);
    const deferAt = nextZonedDayStartIso(new Date(now), orgTimeZone);
    await docRef.update({
      status: "pending",
      // Quota deferral moves readiness; keep original scheduledAt for display.
      notBeforeAt: deferAt,
      nextRetryAt: deferAt,
      error: quota.error,
      failureKind: "quota",
      lastSkipReason: "quota",
      lastSkipAt: now,
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
    return { outcome: "skipped", reason: "quota", detail: quota.error };
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
    return { outcome: "failed" };
  }

  const finalStopReason = followupIdEarly
    ? await shouldStopScheduledFollowupEmail(followupIdEarly)
    : undefined;
  if (followupIdEarly && finalStopReason === FOLLOWUP_MISSING_STOP_REASON) {
    console.warn(
      `[scheduled-send] Follow-up "${followupIdEarly}" vanished before dispatch on "${docRef.id}" — sending as standalone`,
    );
    followupIdEarly = "";
  } else if (followupIdEarly && finalStopReason) {
    return cancelDueToFollowupStop(docRef, followupIdEarly, finalStopReason);
  }

  let subject = String(data.subject ?? "");
  let inReplyTo = String(data.inReplyTo ?? "") || undefined;
  let referenceIds = Array.isArray(data.referenceIds)
    ? data.referenceIds.map(String).filter(Boolean).slice(-50)
    : undefined;
  const forceNewThread = data.forceNewThread === true;

  if (followupIdEarly) {
    const thread = await resolveSequenceThreadingForFollowup({
      followupId: followupIdEarly,
      existingInReplyTo: inReplyTo,
      forceNewThread,
    });
    if (thread.kind === "wait_for_prior") {
      const waitingSinceMs =
        coerceInstantMs(data.waitingForPriorSince) ?? coerceInstantMs(data.scheduledAt);
      // Unparseable clock → do not block forever.
      const waitedTooLong =
        waitingSinceMs == null || Date.now() - waitingSinceMs >= WAIT_FOR_PRIOR_MAX_MS;
      if (!waitedTooLong) {
        const nowIso = new Date().toISOString();
        const blockedBy = thread.blockedBy.followupId;
        await releaseScheduledClaim(docRef, {
          lastSkipReason: "wait_for_prior",
          lastSkipAt: nowIso,
          blockedByFollowupId: blockedBy,
          ...(data.waitingForPriorSince
            ? {}
            : { waitingForPriorSince: nowIso }),
        });
        return {
          outcome: "skipped",
          reason: "wait_for_prior",
          blockedByFollowupId: blockedBy,
          detail: `blocked by ${blockedBy} (${thread.blockedBy.deliveryStatus ?? "unknown"})`,
        };
      }
      // Prior step never completed — send as a new thread root rather than stall forever.
    }
    if (thread.kind === "reply") {
      inReplyTo = thread.inReplyTo;
      referenceIds = thread.referenceIds;
      subject = thread.subject;
    }
  }

  console.log(`[scheduled-send] Dispatching outbound mail via sendOutboundMailServer for doc "${docRef.id}":`, {
    to: data.to,
    from: data.from ?? mailbox.emailAddress,
    subject,
    mailboxOwnerUid,
    mailboxId,
    smtpHost: mailbox.smtp.host,
    connectionType: mailbox.connectionType,
  });

  const result = await sendOutboundMailServer({
    organizationId,
    uid: mailboxOwnerUid,
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
    tracking: {
      trackOpens: Boolean(mailbox.readReceipts),
      trackClicks: Boolean(mailbox.trackClicks),
      leadId: leadId || undefined,
      followupId: followupIdEarly || undefined,
      scheduledEmailId: docRef.id,
    },
  });

  console.log(`[scheduled-send] sendOutboundMailServer result for doc "${docRef.id}":`, {
    ok: result.ok,
    messageId: (result as { messageId?: string }).messageId,
    error: (result as { error?: string }).error,
  });

  const now = new Date().toISOString();
  if (result.ok) {
    const messageId = normalizeMessageId(result.messageId);
    console.log(`[scheduled-send] SUCCESS: Marked scheduled doc "${docRef.id}" as sent (messageId: ${messageId || "none"})`);
    await docRef.update({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      error: null,
      failureKind: FieldValue.delete(),
      nextRetryAt: FieldValue.delete(),
      notBeforeAt: FieldValue.delete(),
      waitingForPriorSince: FieldValue.delete(),
      blockedByFollowupId: FieldValue.delete(),
      lastSkipReason: FieldValue.delete(),
      lastSkipAt: FieldValue.delete(),
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
        mailboxId,
        fromEmail: String(data.from ?? mailbox.emailAddress ?? ""),
        toEmail: String(data.to ?? ""),
        mailboxOwnerUid,
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
        mailboxOwnerUid,
        scheduledByUserId,
        leadId,
        subject,
        messageId,
        followupId: followupId || undefined,
        mailboxId,
      });
      try {
        await persistOutboundLeadMailServer({
          organizationId,
          leadId,
          mailboxId,
          mailboxOwnerUid,
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
          attachments: outboundAttachmentsToLeadMail(parsedAttachments),
          source: followupId ? "crm_followup" : "scheduled",
        });
      } catch {
        /* Delivery succeeded; lead-mail persist is best-effort. */
      }
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
      await releaseMailboxScheduleSlotServer({
        organizationId,
        uid: mailboxOwnerUid,
        mailboxId,
        scheduledAt: String(data.scheduledAt ?? now),
      });
    } catch {
      /* Delivery is authoritative; quota accounting can recover independently. */
    }
    if (runContext) {
      runContext.lastSentAtByMailbox.set(`${organizationId}/${mailboxOwnerUid}/${mailboxId}`, Date.now());
    }
    return { outcome: "sent" };
  }

  console.error(`[scheduled-send] FAILURE: Outbound send returned error for doc "${docRef.id}": ${result.error}`);

  await releaseMailboxDailySendServer({
    organizationId,
    uid: mailboxOwnerUid,
    mailboxId,
  }).catch(() => null);

  const attempts = Math.max(0, Number(data.attempts ?? 0)) + 1;
  const kind = classifyScheduledSendError(result.error);
  const errorText = result.error.slice(0, 500);

  if (kind === "transient" && attempts < SCHEDULED_SEND_MAX_ATTEMPTS) {
    const retryAt = nextRetryAtIso(attempts);
    await docRef.update({
      status: "pending",
      // Transient retry readiness — keep original scheduledAt for UI.
      notBeforeAt: retryAt,
      attempts,
      nextRetryAt: retryAt,
      error: errorText,
      failureKind: "transient",
      lastSkipReason: "other",
      lastSkipAt: now,
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
    return { outcome: "skipped", reason: "other", detail: errorText };
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
    waitingForPriorSince: FieldValue.delete(),
    blockedByFollowupId: FieldValue.delete(),
    lastSkipReason: FieldValue.delete(),
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
  return { outcome: "failed" };
}

async function processScheduledSnap(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> }>,
  opts?: {
    requeueSendGaps?: boolean;
    /** Stop claiming more docs after this wall-clock budget (local process-due). */
    maxDurationMs?: number;
  },
): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  claimRefused: number;
  skipReasons: Record<ScheduledSkipReason, number>;
  rows: ScheduledFlushRowResult[];
}> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;
  let claimRefused = 0;
  const skipReasons = emptySkipReasons();
  const rows: ScheduledFlushRowResult[] = [];
  const runContext = {
    lastSentAtByMailbox: new Map<string, number>(),
    requeueSendGaps: Boolean(opts?.requeueSendGaps),
  };
  const deadline =
    typeof opts?.maxDurationMs === "number" && opts.maxDurationMs > 0
      ? Date.now() + opts.maxDurationMs
      : null;

  for (const doc of docs) {
    if (deadline != null && Date.now() >= deadline) {
      const remaining = docs.length - processed;
      skipped += remaining;
      skipReasons.deadline += remaining;
      for (let i = processed; i < docs.length; i++) {
        rows.push({ id: docs[i]!.ref.id, outcome: "skipped", reason: "deadline" });
      }
      break;
    }
    processed += 1;
    const claimed = await claimScheduledDoc(doc.ref);
    if (!claimed) {
      skipped += 1;
      claimRefused += 1;
      skipReasons.claim_refused += 1;
      rows.push({ id: doc.ref.id, outcome: "skipped", reason: "claim_refused" });
      continue;
    }
    try {
      const result = await sendScheduledDoc(doc.ref, claimed, runContext);
      if (result.outcome === "sent") {
        sent += 1;
        rows.push({ id: doc.ref.id, outcome: "sent" });
      } else if (result.outcome === "failed") {
        failed += 1;
        rows.push({ id: doc.ref.id, outcome: "failed", reason: result.reason, detail: result.detail });
      } else {
        skipped += 1;
        const reason = result.reason ?? "other";
        skipReasons[reason] += 1;
        rows.push({
          id: doc.ref.id,
          outcome: "skipped",
          reason,
          blockedByFollowupId: result.blockedByFollowupId,
          detail: result.detail,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const cause =
        e instanceof Error && e.cause instanceof Error
          ? e.cause.message
          : e instanceof Error && e.cause != null
            ? String(e.cause)
            : undefined;
      console.error("[scheduled-email] send threw", {
        path: doc.ref.path,
        message,
        cause,
      });
      const nowIso = new Date().toISOString();
      const attempts = Math.max(0, Number(claimed.attempts ?? 0)) + 1;
      try {
        await doc.ref.update({
          status: "pending",
          attempts,
          error: message.slice(0, 500),
          failureKind: "transient",
          lastSkipReason: "exception",
          lastSkipAt: nowIso,
          nextRetryAt: nextRetryAtIso(attempts),
          notBeforeAt: nextRetryAtIso(attempts),
          updatedAt: nowIso,
          processingAt: FieldValue.delete(),
          processingClaimId: FieldValue.delete(),
        });
      } catch {
        /* best-effort release */
      }
      skipped += 1;
      skipReasons.exception += 1;
      rows.push({
        id: doc.ref.id,
        outcome: "skipped",
        reason: "exception",
        detail: message.slice(0, 200),
      });
    }
  }

  return { processed, sent, failed, skipped, claimRefused, skipReasons, rows };
}

type DueCandidate = {
  ref: DocumentReference;
  data: () => Record<string, unknown>;
};

/** One-pass due selection + deferral diagnostics for pending fallback scans. */
function selectDueFromPending(
  rows: DueCandidate[],
  nowMs: number,
  limit: number,
): {
  dueDocs: DueCandidate[];
  overdueIgnoringNotBefore: number;
  notBeforeBlocked: number;
  unparsedScheduledAt: number;
} {
  let overdueIgnoringNotBefore = 0;
  let notBeforeBlocked = 0;
  let unparsedScheduledAt = 0;
  const dueDocs: DueCandidate[] = [];
  for (const row of rows) {
    const data = row.data();
    const dueMs = coerceInstantMs(data.scheduledAt);
    if (dueMs == null) {
      unparsedScheduledAt += 1;
      continue;
    }
    if (dueMs > nowMs) continue;
    overdueIgnoringNotBefore += 1;
    const notBeforeMs = coerceInstantMs(data.notBeforeAt);
    if (notBeforeMs != null && notBeforeMs > nowMs) {
      notBeforeBlocked += 1;
      continue;
    }
    if (dueDocs.length < limit) dueDocs.push(row);
  }
  return { dueDocs, overdueIgnoringNotBefore, notBeforeBlocked, unparsedScheduledAt };
}

function warnNoDuePending(
  label: string,
  pendingCount: number,
  rows: DueCandidate[],
  stats: {
    overdueIgnoringNotBefore: number;
    notBeforeBlocked: number;
    unparsedScheduledAt: number;
  },
): void {
  if (pendingCount === 0) return;
  const sample = rows.slice(0, 5).map((row) => {
    const data = row.data();
    return {
      id: row.ref.id,
      scheduledAt: coerceIsoInstant(data.scheduledAt) || String(data.scheduledAt ?? ""),
      notBeforeAt: data.notBeforeAt
        ? coerceIsoInstant(data.notBeforeAt) || String(data.notBeforeAt)
        : null,
      lastSkipReason: data.lastSkipReason ?? null,
    };
  });
  console.warn(
    `[${label}] No due rows among ${pendingCount} pending (overdueIgnoringNotBefore=${stats.overdueIgnoringNotBefore}, notBeforeBlocked=${stats.notBeforeBlocked}, unparsedScheduledAt=${stats.unparsedScheduledAt}). sample=`,
    sample,
  );
}

function pendingDiagnostics(
  rows: DueCandidate[],
  nowMs: number,
  stats: {
    overdueIgnoringNotBefore: number;
    notBeforeBlocked: number;
    unparsedScheduledAt: number;
  },
): {
  nowIso: string;
  earliestPendingScheduledAt: string | null;
  overdueIgnoringNotBefore: number;
  notBeforeBlocked: number;
  unparsedScheduledAt: number;
  sample: Array<{
    id: string;
    uid: string | null;
    scheduledAt: string;
    notBeforeAt: string | null;
    lastSkipReason: unknown;
  }>;
} {
  let earliestMs: number | null = null;
  let earliestIso: string | null = null;
  for (const row of rows) {
    const ms = coerceInstantMs(row.data().scheduledAt);
    if (ms == null) continue;
    if (earliestMs == null || ms < earliestMs) {
      earliestMs = ms;
      earliestIso = coerceIsoInstant(row.data().scheduledAt);
    }
  }
  return {
    nowIso: new Date(nowMs).toISOString(),
    earliestPendingScheduledAt: earliestIso,
    overdueIgnoringNotBefore: stats.overdueIgnoringNotBefore,
    notBeforeBlocked: stats.notBeforeBlocked,
    unparsedScheduledAt: stats.unparsedScheduledAt,
    sample: rows.slice(0, 5).map((row) => {
      const data = row.data();
      const fromPath = ownerFromScheduledRef(row.ref);
      return {
        id: row.ref.id,
        uid: fromPath.uid ?? (typeof data.uid === "string" ? data.uid : null),
        scheduledAt: coerceIsoInstant(data.scheduledAt) || String(data.scheduledAt ?? ""),
        notBeforeAt: data.notBeforeAt
          ? coerceIsoInstant(data.notBeforeAt) || String(data.notBeforeAt)
          : null,
        lastSkipReason: data.lastSkipReason ?? null,
      };
    }),
  };
}

/**
 * Dev/local helper: process due emails for one mailbox owner.
 * Production cron uses processDueScheduledEmailsServer (collection group) with the same claim path.
 */
export async function processDueScheduledEmailsForMemberServer(input: {
  organizationId: string;
  uid: string;
}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dueFound: number;
  pendingCount: number;
  claimRefused: number;
  skipReasons: Record<ScheduledSkipReason, number>;
  rows: ScheduledFlushRowResult[];
  overdueIgnoringNotBefore?: number;
  notBeforeBlocked?: number;
  unparsedScheduledAt?: number;
  diagnostics?: ReturnType<typeof pendingDiagnostics>;
}> {
  if (isScheduledEmailPgV1Enabled()) {
    const { processDueScheduledEmailsPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return processDueScheduledEmailsPgServer({
      organizationId: input.organizationId,
      uid: input.uid,
    });
  }
  const empty = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    dueFound: 0,
    pendingCount: 0,
    claimRefused: 0,
    skipReasons: emptySkipReasons(),
    rows: [] as ScheduledFlushRowResult[],
  };
  const db = getAdminDb();
  if (!db) {
    console.warn(`[scheduled-member-due] Database not configured for member "${input.uid}" in org "${input.organizationId}"`);
    return empty;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  console.log(`[scheduled-member-due] Starting member flush for org: "${input.organizationId}", uid: "${input.uid}", cutoff: "${nowIso}"`);

  const root = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(input.uid)
    .collection(SCHEDULED_COLLECTION);

  // Filter due rows before limit so future-dated pending mail cannot crowd out sends.
  const primary = await root
    .where("status", "in", ["pending", "processing"])
    .where("scheduledAt", "<=", nowIso)
    .orderBy("scheduledAt", "asc")
    .limit(16)
    .get();

  let dueDocs = primary.docs
    .map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    }))
    .filter((row) => isScheduledDocDue(row.data(), nowMs))
    .slice(0, 8);

  let pendingCount = dueDocs.length;
  let overdueIgnoringNotBefore = 0;
  let notBeforeBlocked = 0;
  let unparsedScheduledAt = 0;
  let diagnostics: ReturnType<typeof pendingDiagnostics> | undefined;
  // Fallback only when the indexed due query finds nothing (Timestamp/ISO mismatches).
  if (dueDocs.length === 0) {
    console.log(`[scheduled-member-due] Primary query returned 0 due docs for uid "${input.uid}", checking pending fallback...`);
    const pendingSnap = await root
      .where("status", "in", ["pending", "processing"])
      .orderBy("scheduledAt", "asc")
      .limit(100)
      .get();
    pendingCount = pendingSnap.size;
    const mapped = pendingSnap.docs.map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    }));
    const selected = selectDueFromPending(mapped, nowMs, 8);
    dueDocs = selected.dueDocs;
    overdueIgnoringNotBefore = selected.overdueIgnoringNotBefore;
    notBeforeBlocked = selected.notBeforeBlocked;
    unparsedScheduledAt = selected.unparsedScheduledAt;
    diagnostics = pendingDiagnostics(mapped, nowMs, selected);
    if (dueDocs.length === 0) {
      warnNoDuePending("scheduled-member-due", pendingCount, mapped, selected);
    }
  }

  console.log(`[scheduled-member-due] Found ${dueDocs.length} due docs for member "${input.uid}" (pending count: ${pendingCount})`);

  const result = await processScheduledSnap(dueDocs, {
    requeueSendGaps: true,
    maxDurationMs: 20_000,
  });

  console.log(`[scheduled-member-due] Member flush complete for uid "${input.uid}": sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}, dueFound=${dueDocs.length}`);

  return {
    ...result,
    dueFound: dueDocs.length,
    pendingCount,
    overdueIgnoringNotBefore,
    notBeforeBlocked,
    unparsedScheduledAt,
    diagnostics,
  };
}

/**
 * Process due emails across the entire organization (multi-member safe).
 * Allows any member's client flush to send due sequence/follow-up mail
 * without depending on member-specific routing or a background cron.
 */
export async function processDueScheduledEmailsForOrgServer(input: {
  organizationId: string;
}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dueFound: number;
  pendingCount: number;
  claimRefused: number;
  skipReasons: Record<ScheduledSkipReason, number>;
  rows: ScheduledFlushRowResult[];
  overdueIgnoringNotBefore?: number;
  notBeforeBlocked?: number;
  unparsedScheduledAt?: number;
  diagnostics?: ReturnType<typeof pendingDiagnostics>;
}> {
  if (isScheduledEmailPgV1Enabled()) {
    const { processDueScheduledEmailsPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return processDueScheduledEmailsPgServer({
      organizationId: input.organizationId,
    });
  }
  const empty = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    dueFound: 0,
    pendingCount: 0,
    claimRefused: 0,
    skipReasons: emptySkipReasons(),
    rows: [] as ScheduledFlushRowResult[],
  };
  const db = getAdminDb();
  if (!db) {
    console.warn(`[scheduled-org-due] Database not configured for org "${input.organizationId}"`);
    return empty;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  console.log(`[scheduled-org-due] Starting org-wide due processing for org: "${input.organizationId}", cutoff time: "${nowIso}"`);

  const isDocInOrg = (docRef: DocumentReference, data: Record<string, unknown>) => {
    const fromPath = ownerFromScheduledRef(docRef);
    const docOrg = String(data.organizationId ?? fromPath.organizationId ?? "");
    return docOrg === input.organizationId;
  };

  // Try org-scoped collectionGroup query first
  let primaryDocs: DocumentSnapshot[] = [];
  try {
    const orgSnap = await db
      .collectionGroup(SCHEDULED_COLLECTION)
      .where("organizationId", "==", input.organizationId)
      .where("status", "in", ["pending", "processing"])
      .where("scheduledAt", "<=", nowIso)
      .orderBy("scheduledAt", "asc")
      .limit(80)
      .get();
    primaryDocs = orgSnap.docs;
    console.log(`[scheduled-org-due] Org-scoped collectionGroup query returned ${primaryDocs.length} candidate docs for org "${input.organizationId}"`);
  } catch (err) {
    console.warn(`[scheduled-org-due] Org-scoped query threw (falling back to global collectionGroup):`, err);
    try {
      const globalSnap = await db
        .collectionGroup(SCHEDULED_COLLECTION)
        .where("status", "in", ["pending", "processing"])
        .where("scheduledAt", "<=", nowIso)
        .orderBy("scheduledAt", "asc")
        .limit(100)
        .get();
      primaryDocs = globalSnap.docs;
      console.log(`[scheduled-org-due] Global collectionGroup query returned ${primaryDocs.length} candidate docs`);
    } catch (globalErr) {
      console.error(`[scheduled-org-due] Global collectionGroup query also failed:`, globalErr);
    }
  }

  let dueDocs = primaryDocs
    .filter((doc) => isDocInOrg(doc.ref, doc.data() as Record<string, unknown>))
    .map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    }))
    .filter((row) => isScheduledDocDue(row.data(), nowMs))
    .slice(0, 16);

  let pendingCount = dueDocs.length;
  let overdueIgnoringNotBefore = 0;
  let notBeforeBlocked = 0;
  let unparsedScheduledAt = 0;
  let diagnostics: ReturnType<typeof pendingDiagnostics> | undefined;
  let memberUidsToSweep = new Set<string>();

  if (dueDocs.length === 0) {
    console.log(`[scheduled-org-due] Primary query returned 0 due docs. Checking fallback pending query for org: "${input.organizationId}"`);
    try {
      const byPath = new Map<string, DocumentSnapshot>();
      const orgSnap = await db
        .collectionGroup(SCHEDULED_COLLECTION)
        .where("organizationId", "==", input.organizationId)
        .where("status", "in", ["pending", "processing"])
        .orderBy("scheduledAt", "asc")
        .limit(200)
        .get();
      for (const doc of orgSnap.docs) {
        if (isDocInOrg(doc.ref, doc.data() as Record<string, unknown>)) {
          byPath.set(doc.ref.path, doc);
        }
      }
      const pathSnap = await db
        .collectionGroup(SCHEDULED_COLLECTION)
        .where("status", "in", ["pending", "processing"])
        .orderBy("scheduledAt", "asc")
        .limit(300)
        .get();
      for (const doc of pathSnap.docs) {
        if (byPath.has(doc.ref.path)) continue;
        if (isDocInOrg(doc.ref, doc.data() as Record<string, unknown>)) {
          byPath.set(doc.ref.path, doc);
        }
      }

      const mapped = [...byPath.values()].map((doc) => ({
        ref: doc.ref,
        data: () => doc.data() as Record<string, unknown>,
      }));
      mapped.sort((a, b) => {
        const aMs = coerceInstantMs(a.data().scheduledAt) ?? Number.POSITIVE_INFINITY;
        const bMs = coerceInstantMs(b.data().scheduledAt) ?? Number.POSITIVE_INFINITY;
        return aMs - bMs;
      });
      pendingCount = mapped.length;
      const selected = selectDueFromPending(mapped, nowMs, 16);
      dueDocs = selected.dueDocs;
      overdueIgnoringNotBefore = selected.overdueIgnoringNotBefore;
      notBeforeBlocked = selected.notBeforeBlocked;
      unparsedScheduledAt = selected.unparsedScheduledAt;
      diagnostics = pendingDiagnostics(mapped, nowMs, selected);
      for (const row of mapped) {
        const uid = ownerFromScheduledRef(row.ref).uid;
        if (uid) memberUidsToSweep.add(uid);
      }
      console.log(
        `[scheduled-org-due] Fallback pending query found ${dueDocs.length} due docs out of ${pendingCount} org pending rows (overdueIgnoringNotBefore=${overdueIgnoringNotBefore}, notBeforeBlocked=${notBeforeBlocked}, unparsedScheduledAt=${unparsedScheduledAt})`,
      );
      if (dueDocs.length === 0) {
        warnNoDuePending("scheduled-org-due", pendingCount, mapped, selected);
      }
    } catch (e) {
      console.warn(`[scheduled-org-due] Fallback pending collectionGroup query failed:`, e);
    }
  }

  // Path-scoped member queries are the same path list/create uses. If collectionGroup
  // typing/filters miss dues, sweep each member root that owns pending mail.
  if (dueDocs.length === 0 && memberUidsToSweep.size > 0) {
    console.log(
      `[scheduled-org-due] Sweeping ${memberUidsToSweep.size} member roots with path-scoped due queries`,
    );
    const swept: DueCandidate[] = [];
    for (const uid of memberUidsToSweep) {
      const root = db
        .collection(COLLECTIONS.organizations)
        .doc(input.organizationId)
        .collection(ORG_SUBCOLLECTIONS.members)
        .doc(uid)
        .collection(SCHEDULED_COLLECTION);
      const memberSnap = await root
        .where("status", "in", ["pending", "processing"])
        .where("scheduledAt", "<=", nowIso)
        .orderBy("scheduledAt", "asc")
        .limit(16)
        .get();
      for (const doc of memberSnap.docs) {
        swept.push({
          ref: doc.ref,
          data: () => doc.data() as Record<string, unknown>,
        });
      }
    }
    dueDocs = swept.filter((row) => isScheduledDocDue(row.data(), nowMs)).slice(0, 16);
    console.log(`[scheduled-org-due] Member-root sweep found ${dueDocs.length} due docs`);
  }

  console.log(`[scheduled-org-due] Dispatching ${dueDocs.length} due docs to processScheduledSnap for org "${input.organizationId}"`);

  const result = await processScheduledSnap(dueDocs, {
    requeueSendGaps: true,
    maxDurationMs: 20_000,
  });

  console.log(`[scheduled-org-due] Completed org-wide processing for org "${input.organizationId}":`, {
    processed: result.processed,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    dueFound: dueDocs.length,
    pendingCount,
    overdueIgnoringNotBefore,
    notBeforeBlocked,
    unparsedScheduledAt,
    diagnostics,
    skipReasons: result.skipReasons,
  });

  return {
    ...result,
    dueFound: dueDocs.length,
    pendingCount,
    overdueIgnoringNotBefore,
    notBeforeBlocked,
    unparsedScheduledAt,
    diagnostics,
  };
}

export async function processDueScheduledEmailsServer(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dueFound: number;
  pendingCount: number;
  claimRefused: number;
  skipReasons: Record<ScheduledSkipReason, number>;
  rows: ScheduledFlushRowResult[];
}> {
  if (isScheduledEmailPgV1Enabled()) {
    const { runScheduledEmailTickServer } = await import(
      "@/lib/email/scheduled-email-tick-server"
    );
    const tick = await runScheduledEmailTickServer();
    return {
      processed: tick.claimed,
      sent: 0,
      failed: 0,
      skipped: 0,
      dueFound: tick.claimed,
      pendingCount: tick.claimed,
      claimRefused: 0,
      skipReasons: emptySkipReasons(),
      rows: [],
    };
  }
  const empty = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    dueFound: 0,
    pendingCount: 0,
    claimRefused: 0,
    skipReasons: emptySkipReasons(),
    rows: [] as ScheduledFlushRowResult[],
  };
  const db = getAdminDb();
  if (!db) return empty;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const primary = await db
    .collectionGroup(SCHEDULED_COLLECTION)
    .where("status", "in", ["pending", "processing"])
    .where("scheduledAt", "<=", nowIso)
    .orderBy("scheduledAt", "asc")
    .limit(80)
    .get();

  let dueDocs = primary.docs
    .map((doc) => ({
      ref: doc.ref,
      data: () => doc.data() as Record<string, unknown>,
    }))
    .filter((row) => isScheduledDocDue(row.data(), nowMs))
    .slice(0, 50);

  let pendingCount = dueDocs.length;
  if (dueDocs.length === 0) {
    const pendingSnap = await db
      .collectionGroup(SCHEDULED_COLLECTION)
      .where("status", "in", ["pending", "processing"])
      .limit(100)
      .get();
    pendingCount = pendingSnap.size;
    dueDocs = pendingSnap.docs
      .map((doc) => ({
        ref: doc.ref,
        data: () => doc.data() as Record<string, unknown>,
      }))
      .filter((row) => isScheduledDocDue(row.data(), nowMs))
      .sort((a, b) => {
        const aMs = coerceInstantMs(a.data().scheduledAt) ?? 0;
        const bMs = coerceInstantMs(b.data().scheduledAt) ?? 0;
        return aMs - bMs;
      })
      .slice(0, 50);
  }

  const result = await processScheduledSnap(dueDocs);
  return {
    ...result,
    dueFound: dueDocs.length,
    pendingCount,
  };
}

/** Manual retry: re-queue a failed (or exhausted) scheduled email for immediate send. */
export async function retryScheduledEmailServer(input: {
  organizationId: string;
  uid: string;
  id: string;
}): Promise<{ ok: true; scheduledAt: string } | { error: string }> {
  if (isScheduledEmailPgV1Enabled()) {
    const { retryScheduledEmailPgServer } = await import(
      "@/lib/email/scheduled-emails-pg-server"
    );
    return retryScheduledEmailPgServer(input);
  }
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

  await nudgeScheduledEmailWorker(scheduledAt);

  return { ok: true, scheduledAt };
}
