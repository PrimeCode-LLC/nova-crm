import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/firestore/tenant-write";
import {
  appendGlobalEmailFooter,
  appendMailboxSignature,
} from "@/lib/email/append-mailbox-signature";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { getLeadMailMessageServer } from "@/lib/email/lead-mail-store-server";
import { getEmailAccountMetaServer, getMailboxProfileServer, listMailboxesForMemberServer } from "@/lib/email/mailbox-profiles-server";
import {
  assertMailboxDailySendQuotaServer,
  incrementMailboxSendCountServer,
} from "@/lib/email/mailbox-send-quota-server";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { replySubject } from "@/lib/email/reply-compose";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { getReplyActionServer } from "@/lib/email/classify-inbound-reply-server";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";

function bodyToHtml(body: string): string {
  return body
    .split("\n")
    .map((line) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      return `<p>${escaped || "<br/>"}</p>`;
    })
    .join("");
}

function mailboxSendReady(mailbox: {
  enabled?: boolean;
  emailAddress?: string;
  smtp: { host: string; user: string };
}): boolean {
  if (mailbox.enabled === false) return false;
  if (!mailbox.emailAddress?.trim()) return false;
  if (!mailbox.smtp.host?.trim() || !mailbox.smtp.user?.trim()) return false;
  return true;
}

async function resolveSendMailbox(input: {
  organizationId: string;
  actionMailboxId: string;
  actionMailboxOwnerUid?: string;
  leadOwnerId: string;
  actorUid: string;
}): Promise<
  | { ok: true; mailboxId: string; ownerUid: string }
  | { ok: false; error: string }
> {
  const candidates: Array<{ ownerUid: string; mailboxId: string }> = [];
  if (
    input.actionMailboxId &&
    input.actionMailboxId !== "instantly" &&
    input.actionMailboxId !== "crm" &&
    input.actionMailboxOwnerUid
  ) {
    candidates.push({
      ownerUid: input.actionMailboxOwnerUid,
      mailboxId: input.actionMailboxId,
    });
  }

  for (const uid of [input.leadOwnerId, input.actorUid, input.actionMailboxOwnerUid].filter(Boolean)) {
    const mailboxes = await listMailboxesForMemberServer({
      organizationId: input.organizationId,
      uid: uid!,
    });
    const ready = mailboxes.find((m) => mailboxSendReady(m));
    if (ready) {
      candidates.push({ ownerUid: uid!, mailboxId: ready.id });
      break;
    }
  }

  for (const c of candidates) {
    const profile = await getMailboxProfileServer({
      organizationId: input.organizationId,
      uid: c.ownerUid,
      mailboxId: c.mailboxId,
    });
    if (profile && mailboxSendReady(profile)) {
      return { ok: true, mailboxId: c.mailboxId, ownerUid: c.ownerUid };
    }
  }

  return {
    ok: false,
    error: "No configured mailbox available to send this reply. Connect SMTP in Settings → Email.",
  };
}

/**
 * Approve draft and send via the lead/mailbox owner's SMTP.
 */
export async function sendReplyActionServer(input: {
  organizationId: string;
  actionId: string;
  decidedBy: string;
  draftBody?: string;
  draftSubject?: string;
}): Promise<
  | {
      ok: true;
      messageId?: string;
      subject: string;
      to: string;
      from: string;
      body: string;
      mailboxId: string;
      mailboxOwnerUid: string;
      sentAt: string;
      inReplyTo?: string;
      referenceIds?: string[];
      leadId: string;
    }
  | { ok: false; error: string; status: number }
> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured.", status: 503 };

  const action = await getReplyActionServer({
    organizationId: input.organizationId,
    actionId: input.actionId,
  });
  if (!action) return { ok: false, error: "Reply action not found.", status: 404 };
  if (action.status !== "pending") {
    return { ok: false, error: "Reply action is no longer pending.", status: 409 };
  }

  const draftBody = (input.draftBody ?? action.draftBody ?? "").trim();
  const draftSubject = (input.draftSubject ?? action.draftSubject ?? "").trim();
  if (!draftBody) {
    return { ok: false, error: "No draft body to send. Generate or write a reply first.", status: 409 };
  }

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(action.leadId).get();
  if (!leadSnap.exists || String(leadSnap.data()?.organizationId ?? "") !== input.organizationId) {
    return { ok: false, error: "Lead not found.", status: 404 };
  }
  const lead = mapLeadDoc(leadSnap.id, leadSnap.data() as Record<string, unknown>);

  const contactPolicy = await assertLeadContactAllowedServer({
    organizationId: input.organizationId,
    leadId: action.leadId,
  });
  if (!contactPolicy.ok) {
    return { ok: false, error: contactPolicy.error, status: contactPolicy.status };
  }

  const resolved = await resolveSendMailbox({
    organizationId: input.organizationId,
    actionMailboxId: action.mailboxId,
    actionMailboxOwnerUid: action.mailboxOwnerUid,
    leadOwnerId: lead.ownerId,
    actorUid: input.decidedBy,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error, status: 409 };

  const mailbox = await getMailboxProfileServer({
    organizationId: input.organizationId,
    uid: resolved.ownerUid,
    mailboxId: resolved.mailboxId,
  });
  if (!mailbox || !mailboxSendReady(mailbox)) {
    return { ok: false, error: "Mailbox is not ready to send.", status: 409 };
  }

  const quota = await assertMailboxDailySendQuotaServer({
    organizationId: input.organizationId,
    uid: resolved.ownerUid,
    mailboxId: resolved.mailboxId,
    dailySendLimit: mailbox.dailySendLimit ?? null,
  });
  if (!quota.ok) {
    return { ok: false, error: quota.error, status: quota.status };
  }

  const to = (action.draftTo || lead.contactEmail || "").trim();
  if (!to) return { ok: false, error: "Missing recipient address.", status: 409 };

  // Prefer threading headers from the specific inbound that triggered this action.
  let inReplyTo = normalizeMessageId(action.draftInReplyTo);
  let referenceIds = action.draftReferenceIds?.map((id) => normalizeMessageId(id)).filter(
    (id): id is string => Boolean(id),
  );
  let subject = draftSubject || action.draftSubject || "";
  if (action.inboundProviderKey) {
    const inbound = await getLeadMailMessageServer({
      organizationId: input.organizationId,
      leadId: action.leadId,
      providerKey: action.inboundProviderKey,
    });
    if (inbound) {
      inReplyTo = normalizeMessageId(inbound.messageId) || inReplyTo;
      const refs = [
        ...(inbound.referenceIds ?? []),
        ...(inReplyTo ? [inReplyTo] : []),
      ]
        .map((id) => normalizeMessageId(id))
        .filter((id): id is string => Boolean(id));
      if (refs.length) referenceIds = [...new Set(refs)].slice(-50);
      if (!subject.trim()) subject = replySubject(inbound.subject);
    }
  }
  if (!subject.trim()) subject = "Re:";

  const meta = await getEmailAccountMetaServer({
    organizationId: input.organizationId,
    uid: resolved.ownerUid,
  });
  let outboundBody = appendMailboxSignature(draftBody, mailbox.signature);
  outboundBody = appendGlobalEmailFooter(outboundBody, meta.globalEmailFooter);

  const result = await sendOutboundMailServer({
    organizationId: input.organizationId,
    uid: resolved.ownerUid,
    mailboxId: resolved.mailboxId,
    smtp: {
      host: mailbox.smtp.host,
      port: mailbox.smtp.port,
      secure: mailbox.smtp.secure,
      user: mailbox.smtp.user,
      pass: mailbox.smtp.password,
    },
    imap: mailbox.imap.host
      ? {
          host: mailbox.imap.host,
          port: mailbox.imap.port,
          secure: mailbox.imap.secure,
          user: mailbox.imap.user,
          pass: mailbox.imap.password,
        }
      : undefined,
    appendSentCopy:
      mailbox.connectionType === "google_workspace" || mailbox.connectionType === "microsoft_outlook"
        ? false
        : undefined,
    from: mailbox.emailAddress,
    displayName: mailbox.displayName,
    replyTo: mailbox.replyTo,
    to,
    subject,
    text: outboundBody,
    html: bodyToHtml(outboundBody),
    inReplyTo,
    referenceIds,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  const now = new Date().toISOString();
  const messageId = normalizeMessageId(result.messageId);

  await db.collection(COLLECTIONS.replyActions).doc(action.id).set(
    {
      status: "sent",
      draftBody,
      draftSubject: subject,
      draftStatus: "ready",
      draftInReplyTo: inReplyTo,
      ...(referenceIds?.length ? { draftReferenceIds: referenceIds } : {}),
      sentAt: now,
      ...(messageId ? { sentMessageId: messageId } : {}),
      decidedAt: now,
      decidedBy: input.decidedBy,
      updatedAt: now,
    },
    { merge: true },
  );

  const leadRef = db.collection(COLLECTIONS.leads).doc(action.leadId);
  await leadRef.update({
    replyActionStatus: "sent",
    pendingReplyActionId: FieldValue.delete(),
    nextAction: "Reply sent — wait for their response",
    lastActivityAt: now,
    updatedAt: now,
  });

  await persistOutboundLeadMailServer({
    organizationId: input.organizationId,
    leadId: action.leadId,
    mailboxId: resolved.mailboxId,
    mailboxOwnerUid: resolved.ownerUid,
    from: mailbox.emailAddress,
    to,
    replyTo: mailbox.replyTo,
    subject,
    bodyText: outboundBody,
    bodyHtml: bodyToHtml(outboundBody),
    sentAt: now,
    messageId,
    inReplyTo,
    referenceIds,
    source: "smtp_send",
  });

  try {
    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, lead.ownerId);
    const teId = `te-${crypto.randomUUID()}`;
    await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
      stampForCreate(
        input.organizationId,
        {
          leadId: action.leadId,
          leadOwnerId: lead.ownerId,
          leadOwnerManagerIds,
          type: "email_sent",
          actorId: input.decidedBy,
          summary: `Email sent: ${subject.trim() || "(no subject)"}`,
          payload: {
            source: "reply_intelligence",
            replyActionId: action.id,
            mailboxId: resolved.mailboxId,
            ...(messageId ? { messageId } : {}),
            ...(inReplyTo ? { inReplyTo } : {}),
          },
          createdAt: now,
        },
        input.decidedBy,
      ),
    );
  } catch {
    /* timeline best-effort */
  }

  try {
    await incrementMailboxSendCountServer({
      organizationId: input.organizationId,
      uid: resolved.ownerUid,
      mailboxId: resolved.mailboxId,
    });
  } catch {
    /* send already succeeded */
  }

  return {
    ok: true,
    messageId,
    subject,
    to,
    from: mailbox.emailAddress,
    body: outboundBody,
    mailboxId: resolved.mailboxId,
    mailboxOwnerUid: resolved.ownerUid,
    sentAt: now,
    inReplyTo,
    referenceIds,
    leadId: action.leadId,
  };
}

export async function saveReplyActionDraftServer(input: {
  organizationId: string;
  actionId: string;
  draftBody: string;
  draftSubject?: string;
  decidedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured.", status: 503 };

  const action = await getReplyActionServer({
    organizationId: input.organizationId,
    actionId: input.actionId,
  });
  if (!action) return { ok: false, error: "Reply action not found.", status: 404 };
  if (action.status !== "pending") {
    return { ok: false, error: "Reply action is no longer pending.", status: 409 };
  }

  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.replyActions).doc(action.id).set(
    {
      draftBody: input.draftBody.trim(),
      ...(input.draftSubject !== undefined ? { draftSubject: input.draftSubject.trim() } : {}),
      draftStatus: "ready",
      draftError: null,
      updatedAt: now,
      decidedBy: input.decidedBy,
    },
    { merge: true },
  );
  return { ok: true };
}
