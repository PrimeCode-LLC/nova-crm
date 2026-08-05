import type { MailInbound, MailSent } from "@/lib/email-account-types";
import { isSubjectOnlyMailBody } from "@/lib/email/mail-body-stub";

/** Map an IMAP Sent-folder row into the client `MailSent` shape. */
export function mailInboundToSent(mailboxId: string, m: MailInbound): MailSent {
  const bodySynced = m.bodySynced === true && !isSubjectOnlyMailBody({
    subject: m.subject,
    bodyText: m.bodyText,
    bodyHtml: m.bodyHtml,
  });
  return {
    id: `${mailboxId}:sent:uid-${m.uid}`,
    mailboxId,
    from: m.from,
    replyTo: m.replyTo,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    body: bodySynced ? m.bodyText || "" : "",
    sentAt: m.date,
    uid: m.uid,
    bodySynced: bodySynced ? true : false,
    preview: m.preview,
    bodyHtml: bodySynced ? m.bodyHtml : undefined,
    attachments: m.attachments,
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    referenceIds: m.referenceIds,
  };
}

export function mergeSentMailRow(prev: MailSent | undefined, server: MailSent): MailSent {
  if (!prev) return server;
  const serverStub = isSubjectOnlyMailBody({
    subject: server.subject,
    bodyText: server.body,
    bodyHtml: server.bodyHtml,
  });
  if (prev.bodySynced && (server.bodySynced === false || serverStub)) {
    return {
      ...server,
      body: prev.body,
      bodyHtml: prev.bodyHtml,
      preview: prev.preview || server.preview,
      replyTo: prev.replyTo,
      attachments: prev.attachments,
      messageId: prev.messageId,
      inReplyTo: prev.inReplyTo,
      referenceIds: prev.referenceIds,
      bodySynced: true,
    };
  }
  return {
    ...prev,
    ...server,
    body: server.bodySynced !== false && !serverStub ? server.body || prev.body : prev.body,
    replyTo: server.replyTo ?? prev.replyTo,
    cc: server.cc ?? prev.cc,
    attachments: server.attachments ?? prev.attachments,
    messageId: server.messageId ?? prev.messageId,
    inReplyTo: server.inReplyTo ?? prev.inReplyTo,
    referenceIds: server.referenceIds ?? prev.referenceIds,
  };
}
