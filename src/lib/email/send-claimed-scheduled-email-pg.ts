/**
 * Send a claimed scheduled_emails row (PG path). Gap already reserved at claim time.
 */

import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  FOLLOWUP_MISSING_STOP_REASON,
  scheduledFollowupStopReason,
} from "@/lib/email/scheduled-followup-stop";
import { parseOutboundAttachments } from "@/lib/email/outbound-attachments";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import {
  listMailboxesForMemberServer,
  findMailboxHostInOrgServer,
} from "@/lib/email/mailbox-profiles-server";
import {
  reserveMailboxDailySendServer,
  releaseMailboxDailySendServer,
  releaseMailboxScheduleSlotServer,
} from "@/lib/email/mailbox-send-quota-server";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { outboundAttachmentsToLeadMail } from "@/lib/email/lead-mail-attachments";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";
import {
  resolveSequenceThreadContext,
  SEQUENCE_WAIT_FOR_PRIOR_MAX_MS,
  type SequenceThreadStep,
} from "@/lib/email/sequence-thread";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  SCHEDULED_SEND_MAX_ATTEMPTS,
  classifyScheduledSendError,
  nextRetryAtIso,
  nextZonedDayStartIso,
} from "@/lib/email/scheduled-send-failure";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";
import { recordEmailEvent } from "@/lib/email/email-events-server";
import { isSuppressed } from "@/lib/email/suppression-server";
import { signUnsubscribeToken, unsubscribeUrl } from "@/lib/email/unsubscribe-token";
import {
  getScheduledEmailById,
  markMailboxSentPg,
  releaseClaimToPendingPg,
  updateScheduledEmailPg,
  type ScheduledEmailPayload,
} from "@/lib/email/scheduled-emails-repo";
import type { SendOneJobData } from "@/lib/email/scheduled-email-tick-server";

type SendResult = {
  outcome: "sent" | "failed" | "skipped";
  reason?: string;
  detail?: string;
};

async function updateFollowupDeliveryState(
  followupId: string,
  patch: Record<string, unknown>,
): Promise<string | undefined> {
  const db = getAdminDb();
  if (!db) return undefined;
  try {
    const ref = db.collection(COLLECTIONS.followups).doc(followupId);
    const snap = await ref.get();
    if (!snap.exists) return undefined;
    const data = snap.data() as Record<string, unknown>;
    await ref.update({ ...patch, updatedAt: new Date().toISOString() });
    return typeof data.planId === "string" ? data.planId.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function shouldStopScheduledFollowupEmail(
  followupId: string,
): Promise<string | undefined> {
  const db = getAdminDb();
  if (!db) return undefined;
  try {
    const snap = await db.collection(COLLECTIONS.followups).doc(followupId).get();
    if (!snap.exists) return scheduledFollowupStopReason({ followupExists: false });
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

async function completePlanWhenAllStepsDone(planId: string, now: string): Promise<void> {
  const db = getAdminDb();
  if (!db || !planId) return;
  try {
    const snap = await db
      .collection(COLLECTIONS.followups)
      .where("planId", "==", planId)
      .limit(100)
      .get();
    if (snap.empty) return;
    const allDone = snap.docs.every((d) => {
      const f = d.data() as Record<string, unknown>;
      const status = String(f.deliveryStatus ?? "");
      return status === "sent" || status === "cancelled" || Boolean(f.completedAt);
    });
    if (!allDone) return;
    await db.collection(COLLECTIONS.followupPlans).doc(planId).update({
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
  } catch {
    /* ignore */
  }
}

export async function sendClaimedScheduledEmailPg(
  input: SendOneJobData,
): Promise<SendResult> {
  const row = await getScheduledEmailById({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!row) return { outcome: "skipped", reason: "other", detail: "not_found" };
  if (row.status !== "processing" || row.leaseId !== input.leaseId) {
    return { outcome: "skipped", reason: "claim_refused", detail: "lease_mismatch" };
  }

  const organizationId = input.organizationId;
  const mailboxId = row.mailboxId;
  let mailboxOwnerUid = row.mailboxOwnerUid || row.uid || "";
  let followupId = row.followupId?.trim() || "";
  const leadId = row.leadId?.trim() || "";
  const payload = {
    body: row.body,
    text: row.text,
    html: row.html,
    cc: row.cc,
    bcc: row.bcc,
    replyTo: row.replyTo,
    displayName: row.displayName,
    attachments: row.attachments,
    inReplyTo: row.inReplyTo,
    referenceIds: row.referenceIds,
    forceNewThread: row.forceNewThread,
  } satisfies ScheduledEmailPayload;

  const initialStop = followupId
    ? await shouldStopScheduledFollowupEmail(followupId)
    : undefined;
  if (followupId && initialStop === FOLLOWUP_MISSING_STOP_REASON) {
    followupId = "";
  } else if (followupId && initialStop) {
    await updateScheduledEmailPg(organizationId, input.id, {
      status: "cancelled",
      leaseId: null,
      leaseUntil: null,
      lastSkipReason: "followup_stopped",
      error: initialStop,
    });
    await updateFollowupDeliveryState(followupId, {
      deliveryStatus: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelReason: initialStop,
      scheduledEmailId: FieldValue.delete(),
      emailScheduledAt: FieldValue.delete(),
    });
    return { outcome: "skipped", reason: "followup_stopped", detail: initialStop };
  }

  if (leadId) {
    const contactPolicy = await assertLeadContactAllowedServer({ organizationId, leadId });
    if (!contactPolicy.ok) {
      const cancelled = contactPolicy.status === 409;
      await updateScheduledEmailPg(organizationId, input.id, {
        status: cancelled ? "cancelled" : "failed",
        leaseId: null,
        leaseUntil: null,
        error: contactPolicy.error,
        failureKind: "permanent",
        lastSkipReason: cancelled ? "contact_policy" : null,
      });
      if (followupId) {
        await updateFollowupDeliveryState(followupId, {
          deliveryStatus: cancelled ? "cancelled" : "failed",
          ...(cancelled
            ? {
                cancelledAt: new Date().toISOString(),
                cancelReason: contactPolicy.error,
                scheduledEmailId: FieldValue.delete(),
                emailScheduledAt: FieldValue.delete(),
              }
            : {
                failedAt: new Date().toISOString(),
                deliveryError: contactPolicy.error,
              }),
        });
      }
      return cancelled
        ? { outcome: "skipped", reason: "contact_policy", detail: contactPolicy.error }
        : { outcome: "failed", detail: contactPolicy.error };
    }
  }

  const suppressed = await isSuppressed({ organizationId, email: row.to });
  if (suppressed) {
    await updateScheduledEmailPg(organizationId, input.id, {
      status: "cancelled",
      leaseId: null,
      leaseUntil: null,
      error: "Recipient is suppressed.",
      failureKind: "permanent",
      lastSkipReason: "suppressed",
    });
    if (followupId) {
      await updateFollowupDeliveryState(followupId, {
        deliveryStatus: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancelReason: "Recipient is suppressed.",
        scheduledEmailId: FieldValue.delete(),
        emailScheduledAt: FieldValue.delete(),
      });
    }
    return { outcome: "skipped", reason: "suppressed", detail: "suppressed" };
  }

  let mailbox: EmailMailboxSettings | undefined;
  const memberMailboxes = await listMailboxesForMemberServer({
    organizationId,
    uid: mailboxOwnerUid || row.uid || "",
  });
  mailbox = memberMailboxes.find((m) => m.id === mailboxId);
  if (!mailbox) {
    const hostInfo = await findMailboxHostInOrgServer({ organizationId, mailboxId });
    if (hostInfo) {
      mailbox = hostInfo.mailbox;
      mailboxOwnerUid = hostInfo.uid;
    }
  }
  if (!mailbox) {
    await updateScheduledEmailPg(organizationId, input.id, {
      status: "failed",
      leaseId: null,
      leaseUntil: null,
      error: "Mailbox no longer exists.",
      failureKind: "permanent",
    });
    return { outcome: "failed", detail: "Mailbox no longer exists." };
  }

  const quota = await reserveMailboxDailySendServer({
    organizationId,
    uid: mailboxOwnerUid,
    mailboxId,
    dailySendLimit: mailbox.dailySendLimit,
  });
  if (!quota.ok) {
    const orgTimeZone = await getOrgTimezoneServer(organizationId);
    const deferAt = nextZonedDayStartIso(new Date(), orgTimeZone);
    await releaseClaimToPendingPg({
      organizationId,
      id: input.id,
      leaseId: input.leaseId,
      notBeforeAt: new Date(deferAt),
      failureKind: "quota",
      error: quota.error,
      lastSkipReason: "quota",
      payload: { ...payload, nextRetryAt: deferAt },
    });
    return { outcome: "skipped", reason: "quota", detail: quota.error };
  }

  const parsedAttachments = parseOutboundAttachments(payload.attachments);
  if ("error" in parsedAttachments) {
    await releaseMailboxDailySendServer({
      organizationId,
      uid: mailboxOwnerUid,
      mailboxId,
    }).catch(() => null);
    await updateScheduledEmailPg(organizationId, input.id, {
      status: "failed",
      leaseId: null,
      leaseUntil: null,
      error: parsedAttachments.error,
      failureKind: "permanent",
    });
    return { outcome: "failed", detail: parsedAttachments.error };
  }

  let subject = row.subject;
  let inReplyTo = payload.inReplyTo;
  let referenceIds = payload.referenceIds;
  const forceNewThread = payload.forceNewThread === true;

  if (followupId) {
    const db = getAdminDb();
    if (db) {
      try {
        const followupSnap = await db.collection(COLLECTIONS.followups).doc(followupId).get();
        if (followupSnap.exists) {
          const f = followupSnap.data() as Record<string, unknown>;
          const planId = typeof f.planId === "string" ? f.planId.trim() : "";
          if (planId) {
            const planSteps = await db
              .collection(COLLECTIONS.followups)
              .where("planId", "==", planId)
              .limit(50)
              .get();
            const steps: SequenceThreadStep[] = planSteps.docs.map((d) => {
              const data = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                dueAt: String(data.dueAt ?? ""),
                sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
                deliveryStatus:
                  typeof data.deliveryStatus === "string" ? data.deliveryStatus : undefined,
                sentMessageId:
                  typeof data.sentMessageId === "string" ? data.sentMessageId : undefined,
                emailSubject:
                  typeof data.emailSubject === "string" ? data.emailSubject : undefined,
                title: typeof data.title === "string" ? data.title : undefined,
                scheduledEmailId:
                  typeof data.scheduledEmailId === "string" ? data.scheduledEmailId : undefined,
                emailScheduledAt:
                  typeof data.emailScheduledAt === "string" ? data.emailScheduledAt : undefined,
                pausedAt: typeof data.pausedAt === "string" ? data.pausedAt : undefined,
                completedAt: typeof data.completedAt === "string" ? data.completedAt : undefined,
                freshThread: data.freshThread === true,
              };
            });
            const current = steps.find((s) => s.id === followupId);
            if (current) {
              if (forceNewThread && !current.freshThread) current.freshThread = true;
              if (!normalizeMessageId(inReplyTo)) {
                const thread = resolveSequenceThreadContext(current, steps);
                if (thread.kind === "wait_for_prior") {
                  const waitingSince = row.createdAt ? Date.parse(row.createdAt) : Date.now();
                  const waitedTooLong =
                    !Number.isFinite(waitingSince) ||
                    Date.now() - waitingSince >= SEQUENCE_WAIT_FOR_PRIOR_MAX_MS;
                  if (!waitedTooLong) {
                    await releaseClaimToPendingPg({
                      organizationId,
                      id: input.id,
                      leaseId: input.leaseId,
                      lastSkipReason: "wait_for_prior",
                    });
                    return {
                      outcome: "skipped",
                      reason: "wait_for_prior",
                      detail: `blocked by ${thread.blockedBy.followupId}`,
                    };
                  }
                } else if (thread.kind === "reply") {
                  inReplyTo = thread.inReplyTo;
                  referenceIds = thread.referenceIds;
                  subject = thread.subject;
                }
              }
            }
          }
        }
      } catch {
        /* threading best-effort */
      }
    }
  }

  const unsubToken =
    leadId
      ? signUnsubscribeToken({
          organizationId,
          email: row.to,
          leadId,
        })
      : null;
  const listUnsubscribe =
    unsubToken != null
      ? `<${unsubscribeUrl(unsubToken)}>`
      : undefined;

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
    from: row.from || mailbox.emailAddress,
    displayName: payload.displayName ?? mailbox.displayName,
    replyTo: payload.replyTo ?? mailbox.replyTo,
    to: row.to,
    cc: payload.cc || undefined,
    bcc: payload.bcc || undefined,
    subject,
    text: payload.text ?? payload.body ?? "",
    html: payload.html ?? "",
    inReplyTo,
    referenceIds,
    attachments: parsedAttachments,
    listUnsubscribe,
    tracking: {
      trackOpens: Boolean(mailbox.readReceipts),
      trackClicks: Boolean(mailbox.trackClicks),
      leadId: leadId || undefined,
      followupId: followupId || undefined,
      scheduledEmailId: input.id,
    },
  });

  const now = new Date().toISOString();
  if (result.ok) {
    const messageId = normalizeMessageId(result.messageId);
    await updateScheduledEmailPg(organizationId, input.id, {
      status: "sent",
      sentAt: new Date(now),
      messageId: messageId ?? null,
      leaseId: null,
      leaseUntil: null,
      notBeforeAt: null,
      error: null,
      failureKind: null,
      lastSkipReason: null,
      payload: {
        ...payload,
        inReplyTo,
        referenceIds,
        nextRetryAt: undefined,
      },
    });
    await markMailboxSentPg({
      organizationId,
      mailboxOwnerUid,
      mailboxId,
      gapSeconds: mailbox.sendGapSeconds,
    });
    // Daily send was reserved before SMTP; release the schedule booking now that
    // this pending slot has converted into a sent count.
    await releaseMailboxScheduleSlotServer({
      organizationId,
      uid: mailboxOwnerUid,
      mailboxId,
      scheduledAt: row.scheduledAt,
    }).catch(() => null);

    if (followupId) {
      const planId = await updateFollowupDeliveryState(followupId, {
        deliveryStatus: "sent",
        sentAt: now,
        ...(messageId ? { sentMessageId: messageId } : {}),
        completedAt: now,
        scheduledEmailId: FieldValue.delete(),
        emailScheduledAt: FieldValue.delete(),
        mailboxId,
        fromEmail: row.from || mailbox.emailAddress,
        toEmail: row.to,
        mailboxOwnerUid,
      });
      if (planId) await completePlanWhenAllStepsDone(planId, now);
    }

    if (leadId) {
      try {
        await persistOutboundLeadMailServer({
          organizationId,
          leadId,
          mailboxId,
          mailboxOwnerUid,
          from: row.from || "",
          to: row.to,
          cc: payload.cc || undefined,
          bcc: payload.bcc || undefined,
          replyTo: payload.replyTo || undefined,
          subject,
          bodyText: payload.text ?? payload.body ?? "",
          bodyHtml: payload.html || undefined,
          sentAt: now,
          messageId,
          inReplyTo,
          referenceIds,
          attachments: outboundAttachmentsToLeadMail(parsedAttachments),
          source: followupId ? "crm_followup" : "scheduled",
        });
      } catch {
        /* ignore */
      }
      try {
        await resolvePendingReplyActionOnOutboundServer({
          organizationId,
          leadId,
          decidedBy: row.scheduledByUserId || mailboxOwnerUid,
          messageId,
          sentAt: now,
        });
      } catch {
        /* ignore */
      }
    }

    let sentEventMeta: Record<string, unknown> = {};
    if (followupId) {
      try {
        const { updateProvenanceOnSend } = await import("@/lib/ai/eval/generation-server");
        const sentBody = payload.text ?? payload.body ?? "";
        const sentSubject = subject ?? row.subject ?? "";
        const prov = await updateProvenanceOnSend({
          organizationId,
          followupId,
          sentSubject,
          sentBody,
        });
        if (prov) {
          sentEventMeta = {
            configId: prov.configId,
            generationId: prov.generationId,
            zone: prov.zone,
          };
        }
      } catch {
        /* provenance best-effort */
      }
    }

    try {
      const { getOrganizationAiSettingsServer } = await import(
        "@/lib/ai/ai-settings-server"
      );
      const { isSeedRecipient, seedMetaForRecipient } = await import(
        "@/lib/ai/eval/seed-addresses"
      );
      const aiSettings = await getOrganizationAiSettingsServer(organizationId);
      if (isSeedRecipient(aiSettings, row.to)) {
        sentEventMeta = { ...sentEventMeta, ...seedMetaForRecipient(row.to) };
      }
    } catch {
      /* seed tagging best-effort */
    }

    void recordEmailEvent({
      organizationId,
      type: "sent",
      scheduledEmailId: input.id,
      followupId: followupId || undefined,
      leadId: leadId || undefined,
      mailboxId,
      messageId,
      recipient: row.to,
      meta: sentEventMeta,
    });
    return { outcome: "sent" };
  }

  // SMTP failed — free the daily-send reservation so a retry can re-book.
  await releaseMailboxDailySendServer({
    organizationId,
    uid: mailboxOwnerUid,
    mailboxId,
  }).catch(() => null);

  const attempts = Math.max(0, Number(row.attempts ?? 0)) + 1;
  const kind = classifyScheduledSendError(result.error);
  const errorText = result.error.slice(0, 500);

  if (kind === "transient" && attempts < SCHEDULED_SEND_MAX_ATTEMPTS) {
    const retryAt = nextRetryAtIso(attempts);
    await releaseClaimToPendingPg({
      organizationId,
      id: input.id,
      leaseId: input.leaseId,
      notBeforeAt: new Date(retryAt),
      attempts,
      failureKind: "transient",
      error: errorText,
      lastSkipReason: "other",
      payload: { ...payload, nextRetryAt: retryAt },
    });
    if (followupId) {
      await updateFollowupDeliveryState(followupId, {
        deliveryStatus: "needs_retry",
        failedAt: now,
        deliveryError: errorText,
        deliveryAttempts: attempts,
        emailScheduledAt: retryAt,
      });
      try {
        const db = getAdminDb();
        const fu = db
          ? await db.collection(COLLECTIONS.followups).doc(followupId).get()
          : null;
        const ownerId =
          fu?.exists && typeof fu.data()?.ownerId === "string"
            ? String(fu.data()?.ownerId)
            : mailboxOwnerUid;
        const title =
          fu?.exists && typeof fu.data()?.title === "string"
            ? String(fu.data()?.title)
            : "Sequence email";
        await createUserNotificationServer({
          organizationId,
          recipientId: ownerId,
          actorId: "system",
          kind: "followup",
          message: `Email send will retry: ${title} - ${errorText.slice(0, 180)}`,
          target: title,
          targetHref: leadId ? `/leads/${leadId}` : "/followups",
          entityType: "followup",
          entityId: followupId,
          id: `un-email-needs_retry-${followupId}-${Math.floor(Date.now() / 3_600_000)}`,
        });
      } catch {
        /* ignore */
      }
    }
    void recordEmailEvent({
      organizationId,
      type: "failed",
      scheduledEmailId: input.id,
      followupId: followupId || undefined,
      leadId: leadId || undefined,
      mailboxId,
      recipient: row.to,
      meta: { transient: true, attempts, error: errorText },
    });
    return { outcome: "skipped", reason: "other", detail: errorText };
  }

  await updateScheduledEmailPg(organizationId, input.id, {
    status: "failed",
    attempts,
    failureKind: kind === "quota" ? "quota" : "permanent",
    error: errorText,
    leaseId: null,
    leaseUntil: null,
  });
  if (followupId) {
    await updateFollowupDeliveryState(followupId, {
      deliveryStatus: "failed",
      failedAt: now,
      deliveryError: errorText,
      deliveryAttempts: attempts,
    });
  }
  void recordEmailEvent({
    organizationId,
    type: "failed",
    scheduledEmailId: input.id,
    followupId: followupId || undefined,
    leadId: leadId || undefined,
    mailboxId,
    recipient: row.to,
    meta: { error: errorText },
  });
  return { outcome: "failed", detail: errorText };
}
