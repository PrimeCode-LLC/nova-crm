// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require("nodemailer/lib/mail-composer");

export type OutboundRawMailInput = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
};

/** Build an RFC822 message buffer for IMAP APPEND (same shape as SMTP send). */
export async function buildOutboundRawMail(input: OutboundRawMailInput): Promise<Buffer> {
  const mailOptions = {
    from: input.from,
    to: input.to,
    cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
    subject: input.subject,
    text: input.text || undefined,
    html: input.html || undefined,
    replyTo: input.replyTo || undefined,
    messageId: input.messageId || undefined,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references?.length ? input.references : undefined,
    date: new Date(),
    attachments:
      input.attachments && input.attachments.length > 0
        ? input.attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          }))
        : undefined,
  };

  return new Promise((resolve, reject) => {
    const composer = new MailComposer(mailOptions);
    composer.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
