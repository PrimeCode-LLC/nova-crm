import { randomUUID } from "node:crypto";
import { appendSentMailServer } from "@/lib/email/append-sent-mail-server";
import { buildOutboundRawMail } from "@/lib/email/build-outbound-raw-mail";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { resolveMailboxTransportAuthServer, googleAuthFailureMessage } from "@/lib/email/resolve-mailbox-transport-auth";
import type { OutboundAttachment } from "@/lib/email/outbound-attachments";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { recordMailboxTransportHealthServer } from "@/lib/email/inbox-heads-server";
import {
  collectOutboundTrackingRecipients,
  prepareTrackedHtml,
} from "@/lib/email/mail-tracking-server";
import type { MailTrackingContext } from "@/lib/email/mail-tracking-types";

function sanitizeOutboundMessageId(raw: string | undefined): string | undefined {
  const value = normalizeMessageId(raw);
  if (!value || value.length > 998 || /[\r\n<>]/.test(value)) return undefined;
  return value;
}

export type SendOutboundMailInput = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  /** When set, a copy of the message is appended to the server Sent folder after SMTP send. */
  imap?: { host: string; port: number; secure: boolean; user: string; pass: string };
  /** Gmail and Outlook save SMTP submissions automatically; custom servers may require IMAP APPEND. */
  appendSentCopy?: boolean;
  from: string;
  displayName?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  attachments?: OutboundAttachment[];
  /** First-party open/click tracking (off unless flags are set). */
  tracking?: MailTrackingContext;
};

export async function sendOutboundMailServer(
  input: SendOutboundMailInput,
): Promise<{ ok: true; sentSavedToMailbox: boolean; messageId?: string } | { ok: false; error: string }> {
  const host = normalizeMailHost(input.smtp.host);
  const providerAutoSavesSent =
    host === "smtp.gmail.com" ||
    host.endsWith(".smtp.gmail.com") ||
    host === "smtp.office365.com" ||
    host === "smtp-mail.outlook.com";
  const shouldAppendSentCopy = input.appendSentCopy ?? !providerAutoSavesSent;
  const auth = await resolveMailboxTransportAuthServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: input.mailboxId,
    fallbackUser: input.smtp.user,
    fallbackPass: input.smtp.pass,
    prefer: "smtp",
  });
  const user = auth.user;
  const pass = auth.pass;
  const accessToken = auth.accessToken;

  const from = input.from.trim();
  const toParsed = normalizeRecipientList(input.to, "To");
  if (!toParsed.ok) return { ok: false, error: toParsed.error };
  const ccParsed = input.cc?.trim()
    ? normalizeRecipientList(input.cc, "Cc")
    : { ok: true as const, addresses: [] as string[] };
  if (!ccParsed.ok) return { ok: false, error: ccParsed.error };
  const bccParsed = input.bcc?.trim()
    ? normalizeRecipientList(input.bcc, "Bcc")
    : { ok: true as const, addresses: [] as string[] };
  if (!bccParsed.ok) return { ok: false, error: bccParsed.error };

  if (!host || !user || !from) {
    return { ok: false, error: "SMTP host, user, and From address are required." };
  }
  if (!accessToken && !pass) {
    const error = auth.googleAuthFailure
      ? googleAuthFailureMessage(auth.googleAuthFailure).replace(/^IMAP/i, "SMTP")
      : "SMTP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.";
    await recordMailboxTransportHealthServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
      ok: false,
      error,
    });
    return { ok: false, error };
  }

  const displayName = input.displayName?.trim() ?? "";
  const fromHeader = displayName ? `"${displayName.replace(/"/g, "")}" <${from}>` : from;
  const subject = input.subject.trim() || "(no subject)";
  const messageIdDomain = from.split("@")[1]?.replace(/[^A-Za-z0-9.-]/g, "") || "nova.local";
  const outboundMessageId = `<${randomUUID()}@${messageIdDomain}>`;
  const inReplyToNormalized = sanitizeOutboundMessageId(input.inReplyTo);
  const inReplyTo = inReplyToNormalized ? `<${inReplyToNormalized}>` : undefined;
  const references = [
    ...(input.referenceIds ?? []),
    ...(inReplyToNormalized ? [inReplyToNormalized] : []),
  ]
    .map((value) => sanitizeOutboundMessageId(value))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(-50)
    .map((value) => `<${value}>`);
  const mailAttachments =
    input.attachments && input.attachments.length > 0
      ? input.attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        }))
      : undefined;

  const trackingRecipients = collectOutboundTrackingRecipients({
    to: toParsed.addresses,
    cc: ccParsed.addresses,
    bcc: bccParsed.addresses,
  });
  const tracked = await prepareTrackedHtml({
    html: input.html,
    organizationId: input.organizationId,
    mailboxId: input.mailboxId,
    mailboxOwnerUid: input.uid,
    messageId: outboundMessageId,
    tracking: input.tracking,
    recipients: trackingRecipients,
  });
  const html = tracked.html;
  const personalizedCopies = tracked.htmlByRecipient;
  const fanOutRecipients =
    personalizedCopies && trackingRecipients.length > 1 ? trackingRecipients : null;

  try {
    const rawMessage = await buildOutboundRawMail({
      from: fromHeader,
      to: toParsed.addresses,
      cc: ccParsed.addresses.length > 0 ? ccParsed.addresses : undefined,
      bcc: bccParsed.addresses.length > 0 ? bccParsed.addresses : undefined,
      subject,
      text: input.text || undefined,
      html: html || undefined,
      replyTo: input.replyTo?.trim() || undefined,
      messageId: outboundMessageId,
      inReplyTo,
      references,
      attachments: mailAttachments,
    });

    const sentInfo = await runWithSmtpTransporter(
      host,
      { port: input.smtp.port, secure: input.smtp.secure, user, pass, accessToken },
      async (transporter) => {
        if (!fanOutRecipients) {
          return transporter.sendMail({
            from: fromHeader,
            to: toParsed.addresses,
            cc: ccParsed.addresses.length > 0 ? ccParsed.addresses : undefined,
            bcc: bccParsed.addresses.length > 0 ? bccParsed.addresses : undefined,
            subject,
            text: input.text || undefined,
            html: html || undefined,
            replyTo: input.replyTo?.trim() || undefined,
            messageId: outboundMessageId,
            inReplyTo,
            references: references.length > 0 ? references : undefined,
            attachments: mailAttachments,
          });
        }

        let lastInfo: Awaited<ReturnType<typeof transporter.sendMail>> | undefined;
        for (const recipient of fanOutRecipients) {
          lastInfo = await transporter.sendMail({
            from: fromHeader,
            to: toParsed.addresses,
            cc: ccParsed.addresses.length > 0 ? ccParsed.addresses : undefined,
            subject,
            text: input.text || undefined,
            html: personalizedCopies?.[recipient.email] || html || undefined,
            replyTo: input.replyTo?.trim() || undefined,
            messageId: outboundMessageId,
            inReplyTo,
            references: references.length > 0 ? references : undefined,
            attachments: mailAttachments,
            envelope: { from, to: recipient.email },
          });
        }
        return lastInfo;
      },
    );
    const messageId = fanOutRecipients
      ? normalizeMessageId(outboundMessageId)
      : sentInfo && typeof sentInfo === "object" && "messageId" in sentInfo
        ? normalizeMessageId(String(sentInfo.messageId ?? ""))
        : normalizeMessageId(outboundMessageId);

    const imapHost = normalizeMailHost(input.imap?.host ?? "");
    await recordMailboxTransportHealthServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
      ok: true,
    });
    if (imapHost && shouldAppendSentCopy) {
      const appendResult = await appendSentMailServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: input.mailboxId,
        imap: {
          host: imapHost,
          port: input.imap?.port ?? 993,
          secure: input.imap?.secure ?? true,
          user: input.imap?.user ?? "",
          pass: input.imap?.pass ?? "",
        },
        rawMessage,
      });
      return { ok: true, sentSavedToMailbox: appendResult.ok, messageId };
    }

    return {
      ok: true,
      sentSavedToMailbox: Boolean(imapHost && !shouldAppendSentCopy),
      messageId,
    };
  } catch (e) {
    const error = formatSmtpError(e);
    if (
      /credentials missing/i.test(error) ||
      /authentication/i.test(error) ||
      /login rejected/i.test(error) ||
      /oauth/i.test(error) ||
      /Sign in with Google/i.test(error)
    ) {
      await recordMailboxTransportHealthServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: input.mailboxId,
        ok: false,
        error,
      });
    }
    return { ok: false, error };
  }
}
