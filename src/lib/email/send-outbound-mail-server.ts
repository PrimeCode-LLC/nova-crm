import { appendSentMailServer } from "@/lib/email/append-sent-mail-server";
import { buildOutboundRawMail } from "@/lib/email/build-outbound-raw-mail";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import type { OutboundAttachment } from "@/lib/email/outbound-attachments";

export type SendOutboundMailInput = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  /** When set, a copy of the message is appended to the server Sent folder after SMTP send. */
  imap?: { host: string; port: number; secure: boolean; user: string; pass: string };
  from: string;
  displayName?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: OutboundAttachment[];
};

export async function sendOutboundMailServer(
  input: SendOutboundMailInput,
): Promise<{ ok: true; sentSavedToMailbox: boolean } | { ok: false; error: string }> {
  const host = normalizeMailHost(input.smtp.host);
  let user = input.smtp.user.trim();
  let pass = input.smtp.pass;
  if (input.mailboxId) {
    const secrets = await getMailboxSecretsServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
    });
    if (secrets) {
      const fromVault = secrets.smtp.user.trim();
      if (fromVault) user = fromVault;
      if (secrets.smtp.password) pass = secrets.smtp.password;
    }
  }

  const from = input.from.trim();
  const toParsed = normalizeRecipientList(input.to, "To");
  if (!toParsed.ok) return { ok: false, error: toParsed.error };
  const ccParsed = input.cc?.trim()
    ? normalizeRecipientList(input.cc, "Cc")
    : { ok: true as const, addresses: [] as string[] };
  if (!ccParsed.ok) return { ok: false, error: ccParsed.error };

  if (!host || !user || !from) {
    return { ok: false, error: "SMTP host, user, and From address are required." };
  }

  const displayName = input.displayName?.trim() ?? "";
  const fromHeader = displayName ? `"${displayName.replace(/"/g, "")}" <${from}>` : from;
  const subject = input.subject.trim() || "(no subject)";
  const mailAttachments =
    input.attachments && input.attachments.length > 0
      ? input.attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        }))
      : undefined;

  try {
    const rawMessage = await buildOutboundRawMail({
      from: fromHeader,
      to: toParsed.addresses,
      cc: ccParsed.addresses.length > 0 ? ccParsed.addresses : undefined,
      subject,
      text: input.text || undefined,
      html: input.html || undefined,
      replyTo: input.replyTo?.trim() || undefined,
      attachments: mailAttachments,
    });

    await runWithSmtpTransporter(
      host,
      { port: input.smtp.port, secure: input.smtp.secure, user, pass },
      async (transporter) =>
        transporter.sendMail({
          from: fromHeader,
          to: toParsed.addresses,
          cc: ccParsed.addresses.length > 0 ? ccParsed.addresses : undefined,
          subject,
          text: input.text || undefined,
          html: input.html || undefined,
          replyTo: input.replyTo?.trim() || undefined,
          attachments: mailAttachments,
        }),
    );

    const imapHost = normalizeMailHost(input.imap?.host ?? "");
    if (imapHost) {
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
      return { ok: true, sentSavedToMailbox: appendResult.ok };
    }

    return { ok: true, sentSavedToMailbox: false };
  } catch (e) {
    return { ok: false, error: formatSmtpError(e) };
  }
}
