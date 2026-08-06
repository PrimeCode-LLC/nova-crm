import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  getLeadMailMessageServer,
  listLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { getReplyActionServer } from "@/lib/email/classify-inbound-reply-server";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { resolveReplyReviewAfterReplyActionServer } from "@/lib/leads/resolve-reply-review-after-reply-action-server";

async function markPendingReplyActionSent(input: {
  organizationId: string;
  leadId: string;
  actionId: string;
  decidedBy: string;
  messageId?: string | null;
  sentAt?: string;
}): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return false;

  const now = input.sentAt?.trim() || new Date().toISOString();
  const messageId = normalizeMessageId(input.messageId ?? "");

  const actionRef = db.collection(COLLECTIONS.replyActions).doc(input.actionId);
  const actionSnap = await actionRef.get();
  if (
    actionSnap.exists &&
    String(actionSnap.data()?.organizationId ?? "") === input.organizationId &&
    String(actionSnap.data()?.status ?? "") === "pending"
  ) {
    await actionRef.set(
      {
        status: "sent",
        sentAt: now,
        ...(messageId ? { sentMessageId: messageId } : {}),
        decidedAt: now,
        decidedBy: input.decidedBy,
        updatedAt: now,
        resolvedByManualSend: true,
      },
      { merge: true },
    );
  }

  const leadRef = db.collection(COLLECTIONS.leads).doc(input.leadId);
  const leadSnap = await leadRef.get();
  if (
    leadSnap.exists &&
    String(leadSnap.data()?.organizationId ?? "") === input.organizationId &&
    String(leadSnap.data()?.pendingReplyActionId ?? "") === input.actionId
  ) {
    await leadRef.update({
      replyActionStatus: "sent",
      pendingReplyActionId: FieldValue.delete(),
      nextAction: "Reply sent — wait for their response",
      lastActivityAt: now,
      updatedAt: now,
    });
  }

  return true;
}

/**
 * When a seller sends (or schedules delivery of) an outbound email for a lead that still has a
 * pending reply-intelligence draft, treat that send as handling the inbound — clear the approval
 * banner and mark the action sent.
 */
export async function resolvePendingReplyActionOnOutboundServer(input: {
  organizationId: string;
  leadId: string;
  decidedBy: string;
  messageId?: string | null;
  sentAt?: string;
}): Promise<{ cleared: boolean; actionId?: string }> {
  const leadId = input.leadId.trim();
  if (!leadId) return { cleared: false };

  const db = getAdminDb();
  if (!db) return { cleared: false };

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  if (!leadSnap.exists) return { cleared: false };

  const data = leadSnap.data() ?? {};
  if (String(data.organizationId ?? "") !== input.organizationId) return { cleared: false };
  if (String(data.replyActionStatus ?? "") !== "pending") return { cleared: false };

  const actionId = String(data.pendingReplyActionId ?? "").trim();
  if (!actionId) return { cleared: false };

  const cleared = await markPendingReplyActionSent({
    organizationId: input.organizationId,
    leadId,
    actionId,
    decidedBy: input.decidedBy,
    messageId: input.messageId,
    sentAt: input.sentAt,
  });

  if (cleared) {
    await resolveReplyReviewAfterReplyActionServer({
      organizationId: input.organizationId,
      leadId,
      actorUid: input.decidedBy,
      mode: "completed",
    });
  }

  return cleared ? { cleared: true, actionId } : { cleared: false };
}

/**
 * If the seller already replied in-thread after the inbound that opened this action,
 * clear the pending approval card (covers sends that happened before outbound→RI wiring).
 */
export async function reconcilePendingReplyActionWithOutboundServer(input: {
  organizationId: string;
  actionId: string;
  decidedBy: string;
}): Promise<{ cleared: boolean }> {
  const action = await getReplyActionServer({
    organizationId: input.organizationId,
    actionId: input.actionId,
  });
  if (!action || action.status !== "pending") return { cleared: false };

  const inbound = action.inboundProviderKey
    ? await getLeadMailMessageServer({
        organizationId: input.organizationId,
        leadId: action.leadId,
        providerKey: action.inboundProviderKey,
      })
    : null;

  const inboundDate = inbound?.date || action.createdAt;
  const inboundMessageId = normalizeMessageId(inbound?.messageId ?? action.draftInReplyTo);

  const messages = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: action.leadId,
    limit: 80,
  });

  const matchingOutbound = messages.find((m) => {
    if (m.direction !== "outbound") return false;
    if (inboundMessageId) {
      const replyTo = normalizeMessageId(m.inReplyTo);
      if (replyTo && replyTo === inboundMessageId) return true;
      if (
        Array.isArray(m.referenceIds) &&
        m.referenceIds.some((id) => normalizeMessageId(id) === inboundMessageId)
      ) {
        return true;
      }
    }
    return Boolean(inboundDate) && m.date > inboundDate;
  });

  if (!matchingOutbound) return { cleared: false };

  const cleared = await markPendingReplyActionSent({
    organizationId: input.organizationId,
    leadId: action.leadId,
    actionId: action.id,
    decidedBy: input.decidedBy,
    messageId: matchingOutbound.messageId,
    sentAt: matchingOutbound.date,
  });

  if (cleared) {
    await resolveReplyReviewAfterReplyActionServer({
      organizationId: input.organizationId,
      leadId: action.leadId,
      actorUid: input.decidedBy,
      mode: "completed",
    });
  }

  return { cleared };
}
