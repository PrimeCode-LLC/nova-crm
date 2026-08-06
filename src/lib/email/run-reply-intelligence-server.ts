import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  classifyInboundLeadMailServer,
  getReplyActionServer,
} from "@/lib/email/classify-inbound-reply-server";
import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import type { LeadMailMessage, LeadMailUpsertInput } from "@/lib/email/lead-mail-types";
import {
  formatReplyNextAction,
  replyActionNeedsDraft,
  type ReplyAction,
} from "@/lib/email/reply-action-types";
import { generateReplyActionDraftServer } from "@/lib/email/generate-reply-action-draft-server";
import { stripUndefined } from "@/lib/firestore/strip-undefined";

function leadMailToUpsert(message: LeadMailMessage): LeadMailUpsertInput {
  return {
    mailboxId: message.mailboxId,
    ...(message.mailboxOwnerUid ? { mailboxOwnerUid: message.mailboxOwnerUid } : {}),
    direction: message.direction,
    providerKey: message.providerKey,
    ...(typeof message.uid === "number" ? { uid: message.uid } : {}),
    subject: message.subject,
    from: message.from,
    to: message.to,
    ...(message.cc ? { cc: message.cc } : {}),
    ...(message.bcc ? { bcc: message.bcc } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    date: message.date,
    ...(typeof message.seen === "boolean" ? { seen: message.seen } : {}),
    preview: message.preview,
    bodyText: message.bodyText,
    ...(message.bodyHtml ? { bodyHtml: message.bodyHtml } : {}),
    bodySynced: message.bodySynced,
    ...(message.messageId ? { messageId: message.messageId } : {}),
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    ...(message.referenceIds?.length ? { referenceIds: message.referenceIds } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    source: message.source,
  };
}

function inboundHasUsableBody(message: LeadMailMessage): boolean {
  return (
    message.direction === "inbound" &&
    message.bodySynced !== false &&
    Boolean((message.bodyText ?? message.preview ?? "").trim())
  );
}

function relatedLeadIdsFromDoc(data: Record<string, unknown>, primaryId: string): string[] {
  const ids = new Set<string>([primaryId]);
  const linked = String(data.linkedSalesLeadId ?? "").trim();
  const source = String(data.prospectSourceId ?? "").trim();
  if (linked) ids.add(linked);
  if (source) ids.add(source);
  return [...ids];
}

async function findNewestPendingReplyAction(input: {
  organizationId: string;
  leadIds: string[];
}): Promise<ReplyAction | null> {
  const db = getAdminDb();
  if (!db || input.leadIds.length === 0) return null;

  let best: ReplyAction | null = null;
  for (const leadId of input.leadIds) {
    const snap = await db
      .collection(COLLECTIONS.replyActions)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", leadId)
      .where("status", "==", "pending")
      .limit(8)
      .get();

    for (const doc of snap.docs) {
      const action = await getReplyActionServer({
        organizationId: input.organizationId,
        actionId: doc.id,
      });
      if (!action || action.status !== "pending") continue;
      if (!best || action.updatedAt > best.updatedAt || action.createdAt > best.createdAt) {
        best = action;
      }
    }
  }
  return best;
}

async function stampLeadFromAction(input: {
  organizationId: string;
  leadIds: string[];
  action: ReplyAction;
  ensureDraft?: boolean;
  actorUid: string;
}): Promise<{ nextAction: string; replyClass: string }> {
  const db = getAdminDb();
  if (!db) {
    return { nextAction: "", replyClass: input.action.classification };
  }

  let action = input.action;
  const needsDraft = replyActionNeedsDraft({
    classification: action.classification,
    recommendedAction: action.recommendedAction,
  });

  if (
    input.ensureDraft &&
    needsDraft &&
    action.draftStatus !== "ready" &&
    !(action.draftBody ?? "").trim()
  ) {
    const draft = await generateReplyActionDraftServer({
      organizationId: input.organizationId,
      actionId: action.id,
      actorUid: input.actorUid,
      force: true,
    });
    if (draft.ok) {
      const refreshed = await getReplyActionServer({
        organizationId: input.organizationId,
        actionId: action.id,
      });
      if (refreshed) action = refreshed;
    }
  }

  const baseNext = formatReplyNextAction({
    classification: action.classification,
    nextStepSummary: action.nextStepSummary,
    potentialScore: action.potentialScore,
  });
  const nextAction =
    needsDraft && action.draftStatus === "ready" && (action.draftBody ?? "").trim()
      ? `${baseNext} · Draft ready for approval`
      : needsDraft && (action.draftStatus === "pending" || action.draftStatus === "failed")
        ? action.draftStatus === "failed"
          ? baseNext
          : `${baseNext} · Draft generating…`
        : baseNext;

  const now = new Date().toISOString();
  const patch = stripUndefined({
    pendingReplyActionId: action.id,
    replyClass: action.classification,
    replyActionStatus: "pending" as const,
    nextAction,
    lastActivityAt: now,
    updatedAt: now,
  });

  await Promise.all(
    input.leadIds.map((leadId) =>
      db.collection(COLLECTIONS.leads).doc(leadId).set(patch, { merge: true }),
    ),
  );

  return { nextAction, replyClass: action.classification };
}

export type RunReplyIntelligenceResult =
  | {
      ok: true;
      actionId: string;
      providerKey?: string;
      nextAction?: string;
      replyClass?: string;
      mode: "reattached" | "classified";
      targetLeadId: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
      code: "db" | "lead_not_found" | "no_inbound" | "no_body" | "classify_failed";
    };

/**
 * Detect inbound reply for a lead/prospect and surface a next step:
 * 1) Reattach an existing pending reply-intelligence action if present
 * 2) Otherwise classify the newest stored inbound (force)
 * Stamps denorm fields on the viewed lead and linked prospect/sales-lead ids.
 */
export async function runReplyIntelligenceForLeadServer(input: {
  organizationId: string;
  leadId: string;
  actorUid: string;
}): Promise<RunReplyIntelligenceResult> {
  const db = getAdminDb();
  if (!db) {
    return { ok: false, error: "Database not configured.", status: 503, code: "db" };
  }

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists || String(leadSnap.data()?.organizationId ?? "") !== input.organizationId) {
    return { ok: false, error: "Lead not found.", status: 404, code: "lead_not_found" };
  }

  const leadData = leadSnap.data() as Record<string, unknown>;
  const relatedLeadIds = relatedLeadIdsFromDoc(leadData, input.leadId);

  // Also pull linked docs so prospect ↔ sales lead both get checked for mail/actions.
  for (const relatedId of [...relatedLeadIds]) {
    if (relatedId === input.leadId) continue;
    const relatedSnap = await db.collection(COLLECTIONS.leads).doc(relatedId).get();
    if (!relatedSnap.exists) continue;
    if (String(relatedSnap.data()?.organizationId ?? "") !== input.organizationId) continue;
    for (const id of relatedLeadIdsFromDoc(relatedSnap.data() as Record<string, unknown>, relatedId)) {
      if (!relatedLeadIds.includes(id)) relatedLeadIds.push(id);
    }
  }

  const existingPending = await findNewestPendingReplyAction({
    organizationId: input.organizationId,
    leadIds: relatedLeadIds,
  });

  if (existingPending) {
    const stamped = await stampLeadFromAction({
      organizationId: input.organizationId,
      leadIds: relatedLeadIds,
      action: existingPending,
      ensureDraft: true,
      actorUid: input.actorUid,
    });
    return {
      ok: true,
      actionId: existingPending.id,
      providerKey: existingPending.inboundProviderKey,
      nextAction: stamped.nextAction,
      replyClass: stamped.replyClass,
      mode: "reattached",
      targetLeadId: existingPending.leadId,
    };
  }

  // Prefer inbound mail on the viewed record, then linked ids.
  let newestUsable: LeadMailMessage | null = null;
  let mailLeadId = input.leadId;
  let sawInbound = false;

  for (const leadId of relatedLeadIds) {
    const messages = await listLeadMailMessagesServer({
      organizationId: input.organizationId,
      leadId,
      limit: 40,
    });
    const inbounds = messages.filter((m) => m.direction === "inbound");
    if (inbounds.length > 0) sawInbound = true;
    const candidate = [...inbounds]
      .filter(inboundHasUsableBody)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!candidate) continue;
    if (!newestUsable || candidate.date > newestUsable.date) {
      newestUsable = candidate;
      mailLeadId = leadId;
    }
  }

  if (!sawInbound) {
    return {
      ok: false,
      error: "No inbound reply found for this prospect/lead yet. Sync email first, then try again.",
      status: 409,
      code: "no_inbound",
    };
  }

  if (!newestUsable) {
    return {
      ok: false,
      error:
        "An inbound reply exists, but its body is not synced yet. Open the Emails tab to load the message, then try again.",
      status: 409,
      code: "no_body",
    };
  }

  const result = await classifyInboundLeadMailServer({
    organizationId: input.organizationId,
    leadId: mailLeadId,
    messages: [leadMailToUpsert(newestUsable)],
    actorUid: input.actorUid,
    force: true,
  });

  if (result.classified < 1) {
    return {
      ok: false,
      error: "Reply intelligence could not classify this reply. Try again in a moment.",
      status: 500,
      code: "classify_failed",
    };
  }

  const actionId = String(
    (await db.collection(COLLECTIONS.leads).doc(mailLeadId).get()).data()?.pendingReplyActionId ?? "",
  );
  const action = actionId
    ? await getReplyActionServer({ organizationId: input.organizationId, actionId })
    : null;

  if (action) {
    const stamped = await stampLeadFromAction({
      organizationId: input.organizationId,
      leadIds: relatedLeadIds,
      action,
      ensureDraft: false,
      actorUid: input.actorUid,
    });
    return {
      ok: true,
      actionId: action.id,
      providerKey: newestUsable.providerKey,
      nextAction: stamped.nextAction,
      replyClass: stamped.replyClass,
      mode: "classified",
      targetLeadId: mailLeadId,
    };
  }

  const refreshed = await db.collection(COLLECTIONS.leads).doc(mailLeadId).get();
  const data = refreshed.data() as Record<string, unknown> | undefined;
  return {
    ok: true,
    actionId: String(data?.pendingReplyActionId ?? ""),
    providerKey: newestUsable.providerKey,
    ...(typeof data?.nextAction === "string" && data.nextAction.trim()
      ? { nextAction: data.nextAction.trim() }
      : {}),
    ...(typeof data?.replyClass === "string" && data.replyClass.trim()
      ? { replyClass: data.replyClass.trim() }
      : {}),
    mode: "classified",
    targetLeadId: mailLeadId,
  };
}
