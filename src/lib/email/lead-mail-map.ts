import type { MailInbound, MailInboundAttachment, MailSent } from "@/lib/email-account-types";
import type { LeadEmailMessage } from "@/lib/email/lead-email-conversations";
import { pickLeadMailAttachments } from "@/lib/email/lead-mail-attachments";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import { isSubjectOnlyMailBody } from "@/lib/email/mail-body-stub";
import type { LeadMailMessage, LeadMailUpsertInput } from "@/lib/email/lead-mail-types";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

export function leadMailToLeadEmailMessage(row: LeadMailMessage): LeadEmailMessage {
  if (row.direction === "inbound") {
    const message: MailInbound = {
      id: row.providerKey.includes(":in:")
        ? row.providerKey.split(":in:").slice(1).join(":in:")
        : row.id,
      uid: row.uid ?? 0,
      subject: row.subject,
      from: row.from,
      ...(row.replyTo ? { replyTo: row.replyTo } : {}),
      to: row.to,
      ...(row.cc ? { cc: row.cc } : {}),
      date: row.date,
      seen: row.seen !== false,
      preview: row.preview,
      bodyText: row.bodyText,
      ...(row.bodyHtml ? { bodyHtml: row.bodyHtml } : {}),
      ...(row.messageId ? { messageId: row.messageId } : {}),
      ...(row.inReplyTo ? { inReplyTo: row.inReplyTo } : {}),
      ...(row.referenceIds?.length ? { referenceIds: row.referenceIds } : {}),
      ...(row.attachments ? { attachments: row.attachments } : {}),
      bodySynced: row.bodySynced,
    };
    return {
      key: row.providerKey,
      mailboxId: row.mailboxId,
      direction: "inbound",
      message,
    };
  }

  const message: MailSent = {
    id: row.providerKey.includes(":out:")
      ? row.providerKey.split(":out:").slice(1).join(":out:")
      : row.id,
    mailboxId: row.mailboxId,
    from: row.from,
    ...(row.replyTo ? { replyTo: row.replyTo } : {}),
    to: row.to,
    ...(row.cc ? { cc: row.cc } : {}),
    ...(row.bcc ? { bcc: row.bcc } : {}),
    subject: row.subject,
    body: row.bodyText,
    sentAt: row.date,
    ...(row.uid != null ? { uid: row.uid } : {}),
    bodySynced: row.bodySynced,
    preview: row.preview,
    ...(row.bodyHtml ? { bodyHtml: row.bodyHtml } : {}),
    ...(row.messageId ? { messageId: row.messageId } : {}),
    ...(row.inReplyTo ? { inReplyTo: row.inReplyTo } : {}),
    ...(row.referenceIds?.length ? { referenceIds: row.referenceIds } : {}),
    ...(row.attachments ? { attachments: row.attachments } : {}),
  };
  return {
    key: row.providerKey,
    mailboxId: row.mailboxId,
    direction: "sent",
    message,
  };
}

export function inboundToLeadMailUpsert(
  mailboxId: string,
  message: MailInbound,
  source: LeadMailUpsertInput["source"] = "imap",
  mailboxOwnerUid?: string,
): LeadMailUpsertInput {
  return {
    mailboxId,
    mailboxOwnerUid,
    direction: "inbound",
    providerKey: leadMailProviderKey({
      mailboxId,
      direction: "inbound",
      localId: message.id,
    }),
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    replyTo: message.replyTo,
    date: message.date,
    seen: message.seen,
    preview: message.preview,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    bodySynced: message.bodySynced !== false && Boolean(message.bodyText?.trim() || message.bodyHtml?.trim()),
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    referenceIds: message.referenceIds,
    attachments: message.attachments ?? [],
    source,
  };
}

export function sentToLeadMailUpsert(
  message: MailSent,
  source: LeadMailUpsertInput["source"] = "imap",
  mailboxOwnerUid?: string,
): LeadMailUpsertInput {
  const localId = message.messageId?.trim() || message.id;
  return {
    mailboxId: message.mailboxId,
    mailboxOwnerUid,
    direction: "outbound",
    providerKey: leadMailProviderKey({
      mailboxId: message.mailboxId,
      direction: "outbound",
      localId,
    }),
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    date: message.sentAt,
    seen: true,
    preview: message.preview ?? message.body.slice(0, 240),
    bodyText: message.body,
    bodyHtml: message.bodyHtml,
    bodySynced: message.bodySynced !== false && Boolean(message.body?.trim() || message.bodyHtml?.trim()),
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    referenceIds: message.referenceIds,
    attachments: message.attachments ?? [],
    source,
  };
}

function messageAttachments(row: LeadEmailMessage): MailInboundAttachment[] | undefined {
  return row.message.attachments;
}

function withMergedMailExtras(winner: LeadEmailMessage, loser: LeadEmailMessage): LeadEmailMessage {
  const attachments = pickLeadMailAttachments(messageAttachments(winner), messageAttachments(loser));
  const uid = winner.message.uid || loser.message.uid;
  if (winner.direction === "inbound" && loser.direction === "inbound") {
    return {
      ...winner,
      message: {
        ...winner.message,
        ...(uid != null ? { uid } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        replyTo: winner.message.replyTo || loser.message.replyTo,
        cc: winner.message.cc || loser.message.cc,
        messageId: winner.message.messageId || loser.message.messageId,
        inReplyTo: winner.message.inReplyTo || loser.message.inReplyTo,
        referenceIds: winner.message.referenceIds?.length
          ? winner.message.referenceIds
          : loser.message.referenceIds,
      },
    };
  }
  if (winner.direction === "sent" && loser.direction === "sent") {
    return {
      ...winner,
      message: {
        ...winner.message,
        ...(uid != null ? { uid } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        replyTo: winner.message.replyTo || loser.message.replyTo,
        cc: winner.message.cc || loser.message.cc,
        bcc: winner.message.bcc || loser.message.bcc,
        messageId: winner.message.messageId || loser.message.messageId,
        inReplyTo: winner.message.inReplyTo || loser.message.inReplyTo,
        referenceIds: winner.message.referenceIds?.length
          ? winner.message.referenceIds
          : loser.message.referenceIds,
      },
    };
  }
  return winner;
}

function mergeIdentityKey(row: LeadEmailMessage): string {
  const mid = normalizeMessageId(row.message.messageId);
  if (mid) {
    const dir = row.direction === "inbound" ? "in" : "out";
    return `${row.mailboxId}:${dir}:mid:${mid}`;
  }
  return row.key;
}

/** Merge stored + live messages; prefer body-synced / richer body for the same provider key. */
export function mergeLeadEmailMessages(
  primary: LeadEmailMessage[],
  secondary: LeadEmailMessage[],
): LeadEmailMessage[] {
  const byKey = new Map<string, LeadEmailMessage>();
  const score = (row: LeadEmailMessage): number => {
    const subject = row.message.subject;
    const bodyText = row.direction === "inbound" ? row.message.bodyText : row.message.body;
    const bodyHtml = row.message.bodyHtml;
    const stub = isSubjectOnlyMailBody({ subject, bodyText, bodyHtml });
    const body = stub ? "" : bodyText || row.message.preview || "";
    const synced = row.message.bodySynced !== false && !stub;
    const attachmentBonus = row.message.attachments?.some((att) => att.contentBase64)
      ? 5_000
      : row.message.attachments?.length
        ? 500
        : 0;
    return (synced ? 100_000 : 0) + body.length + attachmentBonus;
  };

  for (const row of [...secondary, ...primary]) {
    const key = mergeIdentityKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const winner = score(row) >= score(prev) ? row : prev;
    const loser = winner === row ? prev : row;
    byKey.set(key, withMergedMailExtras(winner, loser));
  }
  return [...byKey.values()];
}
