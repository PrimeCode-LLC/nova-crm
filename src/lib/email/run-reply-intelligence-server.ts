import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { classifyInboundLeadMailServer } from "@/lib/email/classify-inbound-reply-server";
import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import type { LeadMailMessage, LeadMailUpsertInput } from "@/lib/email/lead-mail-types";

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

export type RunReplyIntelligenceResult =
  | {
      ok: true;
      actionId: string;
      providerKey: string;
      nextAction?: string;
      replyClass?: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
      code: "db" | "lead_not_found" | "no_inbound" | "no_body" | "classify_failed";
    };

/**
 * Manually re-run reply intelligence on the newest stored inbound for a lead.
 * Uses force so a previously skipped / dismissed action can be regenerated.
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

  const messages = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: 40,
  });

  const inbounds = messages.filter((m) => m.direction === "inbound");
  if (inbounds.length === 0) {
    return {
      ok: false,
      error: "No inbound reply is stored for this lead yet. Sync email first, then try again.",
      status: 409,
      code: "no_inbound",
    };
  }

  const newestUsable = [...inbounds]
    .filter(inboundHasUsableBody)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

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
    leadId: input.leadId,
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

  const refreshed = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
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
  };
}
