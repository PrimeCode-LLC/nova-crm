import type { MailInbound, MailSent } from "@/lib/email-account-types";

/** Map an IMAP Sent-folder row into the client `MailSent` shape. */
export function mailInboundToSent(mailboxId: string, m: MailInbound): MailSent {
  const bodySynced = m.bodySynced !== false;
  return {
    id: `${mailboxId}:sent:uid-${m.uid}`,
    mailboxId,
    from: m.from,
    to: m.to,
    subject: m.subject,
    body: bodySynced ? m.bodyText || m.preview || "" : "",
    sentAt: m.date,
    uid: m.uid,
    bodySynced: m.bodySynced,
    preview: m.preview,
    bodyHtml: m.bodyHtml,
  };
}

export function mergeSentMailRow(prev: MailSent | undefined, server: MailSent): MailSent {
  if (!prev) return server;
  if (prev.bodySynced && server.bodySynced === false) {
    return {
      ...server,
      body: prev.body,
      bodyHtml: prev.bodyHtml,
      preview: prev.preview || server.preview,
      bodySynced: true,
    };
  }
  return {
    ...prev,
    ...server,
    body: server.bodySynced !== false ? server.body || prev.body : prev.body,
  };
}
