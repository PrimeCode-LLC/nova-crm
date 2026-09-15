/**
 * Relational (PG) implementations of the scheduled-email facade.
 * Used when SCHEDULED_EMAIL_PG_V1=true.
 */

import { randomUUID } from "node:crypto";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { ScheduledEmail, ScheduledEmailStatus } from "@/lib/email-account-types";
import {
  parseOutboundAttachments,
  serializeOutboundAttachments,
} from "@/lib/email/outbound-attachments";
import { incrementOrgSendLedgerServer } from "@/lib/email/org-send-ledger-server";
import { isQueueHeavyJobsV1Enabled } from "@/lib/queue/flags";
import { enqueueScheduledEmailJob } from "@/lib/queue/enqueue";
import { recordEmailEvent } from "@/lib/email/email-events-server";
import { isSuppressed } from "@/lib/email/suppression-server";
import {
  cancelScheduledEmailPg,
  findActiveScheduledEmailByIdempotencyKey,
  insertScheduledEmail,
  listScheduledEmailsForMemberPg,
  retryScheduledEmailPg,
  type ScheduledEmailPayload,
} from "@/lib/email/scheduled-emails-repo";
import { releaseMailboxScheduleSlotServer } from "@/lib/email/mailbox-send-quota-server";
import type {
  ScheduledFlushRowResult,
  ScheduledSkipReason,
} from "@/lib/email/scheduled-emails-server";

async function nudgeScheduledEmailWorker(scheduledAt: Date | string): Promise<void> {
  if (!isQueueHeavyJobsV1Enabled()) return;
  const when = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) return;
  const delayMs = Math.max(0, when.getTime() - Date.now());
  await enqueueScheduledEmailJob({ delayMs: delayMs + 2_000 }).catch(() => null);
}

/**
 * Cancels the pending row that owns the active idempotency key for `followupId`
 * and releases its ledger reservation. Refuses while a send is in flight.
 */
async function supersedeStaleScheduledEmail(input: {
  organizationId: string;
  followupId: string;
  excludeId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const existing = await findActiveScheduledEmailByIdempotencyKey({
    organizationId: input.organizationId,
    idempotencyKey: input.followupId,
  }).catch(() => null);
  if (!existing || existing.id === input.excludeId) return { ok: false };
  if (existing.status !== "pending") {
    return { ok: false, error: "This follow-up is already being sent right now." };
  }
  const cancelled = await cancelScheduledEmailPg({
    organizationId: input.organizationId,
    uid: existing.mailboxOwnerUid,
    id: existing.id,
    reason: "superseded_by_reschedule",
  });
  if ("error" in cancelled) return { ok: false, error: cancelled.error };
  await incrementOrgSendLedgerServer({
    organizationId: input.organizationId,
    scheduledAt: new Date(existing.scheduledAt),
    delta: -1,
  }).catch(() => null);
  await releaseMailboxScheduleSlotServer({
    organizationId: input.organizationId,
    uid: existing.mailboxOwnerUid,
    mailboxId: existing.mailboxId,
    scheduledAt: existing.scheduledAt,
  }).catch(() => null);
  return { ok: true };
}

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

export async function listScheduledEmailsForMemberPgServer(input: {
  organizationId: string;
  uid: string;
  status?: ScheduledEmailStatus | "pending" | "done";
}): Promise<ScheduledEmail[]> {
  return listScheduledEmailsForMemberPg(input);
}

export async function createScheduledEmailPgServer(input: {
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
  scheduledByUserId?: string;
  followupId?: string;
  leadId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  forceNewThread?: boolean;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const { assertSendingAllowed, resolveArmIdForSend } = await import(
    "@/lib/email/outreach-circuit-breaker-server"
  );
  const armId = await resolveArmIdForSend({
    organizationId: input.organizationId,
    followupId: input.followupId,
    leadId: input.leadId,
  });
  const gate = await assertSendingAllowed(input.organizationId, { armId });
  if (!gate.allowed) {
    return { error: gate.reason ?? "Outreach sending is paused by circuit breaker" };
  }

  const scheduledDate = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { error: "Invalid schedule date." };
  }
  if (scheduledDate.getTime() < Date.now() + 60_000) {
    return { error: "Schedule time must be at least 1 minute in the future." };
  }

  const parsedAttachments = parseOutboundAttachments(input.attachments);
  if ("error" in parsedAttachments) return { error: parsedAttachments.error };

  const suppressed = await isSuppressed({
    organizationId: input.organizationId,
    email: input.to,
  });
  if (suppressed) {
    return { error: "Recipient is on the organization suppression list." };
  }

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

  const id = `sch-${randomUUID()}`;
  const payload: ScheduledEmailPayload = {
    body: input.text,
    text: input.text,
    html: input.html,
    cc: input.cc ?? "",
    bcc: input.bcc ?? "",
    replyTo: input.replyTo ?? "",
    displayName: input.displayName ?? "",
    attachments: serializeOutboundAttachments(parsedAttachments),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.referenceIds?.length
      ? { referenceIds: input.referenceIds.slice(-50) }
      : {}),
    ...(input.forceNewThread ? { forceNewThread: true } : {}),
  };

  const rowInput = {
    id,
    organizationId: input.organizationId,
    mailboxOwnerUid: input.uid,
    mailboxId: input.mailboxId,
    scheduledByUserId: input.scheduledByUserId,
    followupId: followupId || undefined,
    leadId: leadId || undefined,
    scheduledAt: scheduledDate,
    toEmail: input.to,
    fromEmail: input.from,
    subject: input.subject,
    payload,
  };

  let inserted = await insertScheduledEmail(rowInput);
  if ("error" in inserted && followupId) {
    // A still-pending row for this follow-up holds the active idempotency index —
    // usually an orphan whose follow-up lost its scheduledEmailId. Supersede it so
    // re-scheduling the step works instead of dead-ending on a unique violation.
    const superseded = await supersedeStaleScheduledEmail({
      organizationId: input.organizationId,
      followupId,
      excludeId: id,
    });
    if (superseded.ok) inserted = await insertScheduledEmail(rowInput);
    else if (superseded.error) inserted = { error: superseded.error };
  }

  if (!("ok" in inserted) || !inserted.ok) {
    await incrementOrgSendLedgerServer({
      organizationId: input.organizationId,
      scheduledAt: scheduledDate,
      delta: -1,
    });
    return { error: "error" in inserted ? inserted.error : "Could not create scheduled email." };
  }

  const now = new Date().toISOString();
  if (followupId) {
    const db = getAdminDb();
    if (db) {
      try {
        const followupRef = db.collection(COLLECTIONS.followups).doc(followupId);
        await followupRef.update({
          scheduledEmailId: inserted.id,
          emailScheduledAt: scheduledDate.toISOString(),
          deliveryStatus: "scheduled",
          mailboxId: input.mailboxId,
          fromEmail: input.from.trim(),
          toEmail: input.to.trim(),
          mailboxOwnerUid: input.uid,
          pausedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          failedAt: FieldValue.delete(),
          cancelledAt: FieldValue.delete(),
          deliveryError: FieldValue.delete(),
          cancelReason: FieldValue.delete(),
          ...(input.forceNewThread ? { freshThread: true } : {}),
          updatedAt: now,
        });
        const followupSnap = await followupRef.get();
        const planId =
          followupSnap.exists && typeof followupSnap.data()?.planId === "string"
            ? String(followupSnap.data()?.planId).trim()
            : "";
        if (planId) {
          const planRef = db.collection(COLLECTIONS.followupPlans).doc(planId);
          const planSnap = await planRef.get();
          if (planSnap.exists) {
            const planStatus = String(
              (planSnap.data() as Record<string, unknown>).status ?? "",
            );
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
        /* best-effort followup mirror */
      }
    }
  }

  void recordEmailEvent({
    organizationId: input.organizationId,
    type: "scheduled",
    scheduledEmailId: inserted.id,
    followupId: followupId || undefined,
    leadId: leadId || undefined,
    mailboxId: input.mailboxId,
    recipient: input.to,
  });

  await nudgeScheduledEmailWorker(scheduledDate);
  return { ok: true, id: inserted.id };
}

export async function cancelScheduledEmailPgServer(input: {
  organizationId: string;
  uid: string;
  id: string;
  reason?: string;
  followupId?: string;
  fallbackUids?: string[];
}): Promise<{ ok: true } | { error: string }> {
  const tried = new Set<string>();
  const candidates = [input.uid, ...(input.fallbackUids ?? [])]
    .map((u) => u.trim())
    .filter(Boolean);

  let lastError = "Scheduled email not found.";
  for (const memberUid of candidates) {
    if (tried.has(memberUid)) continue;
    tried.add(memberUid);
    const result = await cancelScheduledEmailPg({
      organizationId: input.organizationId,
      uid: memberUid,
      id: input.id,
      reason: input.reason,
    });
    if ("ok" in result && result.ok) {
      const row = result.row;
      if (row?.scheduledAt && row.status !== "sent") {
        await incrementOrgSendLedgerServer({
          organizationId: input.organizationId,
          scheduledAt: new Date(row.scheduledAt),
          delta: -1,
        }).catch(() => null);
        await releaseMailboxScheduleSlotServer({
          organizationId: input.organizationId,
          uid: memberUid,
          mailboxId: row.mailboxId,
          scheduledAt: row.scheduledAt,
        }).catch(() => null);
      }
      const followupId =
        input.followupId?.trim() || row?.followupId?.trim() || "";
      if (followupId) {
        const db = getAdminDb();
        if (db) {
          try {
            await db.collection(COLLECTIONS.followups).doc(followupId).update({
              deliveryStatus: "cancelled",
              cancelledAt: new Date().toISOString(),
              cancelReason: input.reason ?? "cancelled",
              scheduledEmailId: FieldValue.delete(),
              emailScheduledAt: FieldValue.delete(),
              updatedAt: new Date().toISOString(),
            });
          } catch {
            /* ignore */
          }
        }
      }
      void recordEmailEvent({
        organizationId: input.organizationId,
        type: "cancelled",
        scheduledEmailId: input.id,
        followupId: followupId || undefined,
        leadId: row?.leadId,
        mailboxId: row?.mailboxId,
        recipient: row?.to,
        meta: { reason: input.reason },
      });
      return { ok: true };
    }
    if ("error" in result) lastError = result.error;
  }
  return { error: lastError };
}

export async function retryScheduledEmailPgServer(input: {
  organizationId: string;
  uid: string;
  id: string;
}): Promise<{ ok: true; scheduledAt: string } | { error: string }> {
  const scheduledAt = new Date(Date.now() + 60_000);
  const result = await retryScheduledEmailPg({
    organizationId: input.organizationId,
    uid: input.uid,
    id: input.id,
    scheduledAt,
  });
  if (!("ok" in result) || !result.ok) {
    return { error: "error" in result ? result.error : "Retry failed." };
  }

  const followupId = result.row.followupId?.trim();
  if (followupId) {
    const db = getAdminDb();
    if (db) {
      try {
        await db.collection(COLLECTIONS.followups).doc(followupId).update({
          scheduledEmailId: input.id,
          emailScheduledAt: scheduledAt.toISOString(),
          deliveryStatus: "scheduled",
          deliveryError: FieldValue.delete(),
          failedAt: FieldValue.delete(),
          updatedAt: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    }
  }

  await nudgeScheduledEmailWorker(scheduledAt);
  return { ok: true, scheduledAt: scheduledAt.toISOString() };
}

/**
 * Process-due for PG path: enqueue a worker tick (or run dispatcher inline when queue off).
 */
export async function processDueScheduledEmailsPgServer(input?: {
  organizationId?: string;
  uid?: string;
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
  queued?: boolean;
  jobId?: string | null;
}> {
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

  if (isQueueHeavyJobsV1Enabled()) {
    const jobId = await enqueueScheduledEmailJob().catch(() => null);
    return { ...empty, queued: Boolean(jobId), jobId };
  }

  // Local/dev without Redis: run the dispatcher inline.
  const { runScheduledEmailTickServer } = await import(
    "@/lib/email/scheduled-email-tick-server"
  );
  const tick = await runScheduledEmailTickServer({
    organizationId: input?.organizationId,
    mailboxOwnerUid: input?.uid,
  });
  return {
    ...empty,
    processed: tick.claimed,
    dueFound: tick.claimed,
    queued: false,
    jobId: null,
  };
}
