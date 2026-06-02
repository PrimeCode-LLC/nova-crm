import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import type { OutboundAttachment } from "@/lib/email/outbound-attachments";

export type SendOutboundMailInput = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
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
): Promise<{ ok: true } | { ok: false; error: string }> {
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
  const to = input.to.trim();
  if (!host || !user || !from || !to) {
    return { ok: false, error: "SMTP host, user, from, and recipient are required." };
  }

  const displayName = input.displayName?.trim() ?? "";
  const fromHeader = displayName ? `"${displayName.replace(/"/g, "")}" <${from}>` : from;

  try {
    await runWithSmtpTransporter(
      host,
      { port: input.smtp.port, secure: input.smtp.secure, user, pass },
      async (transporter) =>
        transporter.sendMail({
          from: fromHeader,
          to,
          cc: input.cc?.trim() || undefined,
          subject: input.subject.trim() || "(no subject)",
          text: input.text || undefined,
          html: input.html || undefined,
          replyTo: input.replyTo?.trim() || undefined,
          attachments:
            input.attachments && input.attachments.length > 0
              ? input.attachments.map((att) => ({
                  filename: att.filename,
                  content: att.content,
                  contentType: att.contentType,
                }))
              : undefined,
        }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: formatSmtpError(e) };
  }
}
