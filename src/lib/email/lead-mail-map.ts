import type { MailInbound, MailSent } from "@/lib/email-account-types";
import type { LeadEmailMessage } from "@/lib/email/lead-email-conversations";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import type { LeadMailMessage, LeadMailUpsertInput } from "@/lib/email/lead-mail-types";

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
    source,
  };
}

/** Merge stored + live messages; prefer body-synced / richer body for the same provider key. */
export function mergeLeadEmailMessages(
  primary: LeadEmailMessage[],
  secondary: LeadEmailMessage[],
): LeadEmailMessage[] {
  const byKey = new Map<string, LeadEmailMessage>();
  const score = (row: LeadEmailMessage): number => {
    const body =
      row.direction === "inbound"
        ? row.message.bodyText || row.message.preview || ""
        : row.message.body || row.message.preview || "";
    const synced =
      row.direction === "inbound"
        ? row.message.bodySynced !== false
        : row.message.bodySynced !== false;
    return (synced ? 100_000 : 0) + body.length;
  };

  for (const row of [...secondary, ...primary]) {
    const prev = byKey.get(row.key);
    if (!prev || score(row) >= score(prev)) byKey.set(row.key, row);
  }
  return [...byKey.values()];
}
