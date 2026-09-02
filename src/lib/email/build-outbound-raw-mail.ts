import MailComposer from "nodemailer/lib/mail-composer";

export type OutboundRawMailInput = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
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
    bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
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
    // nodemailer CJS deep export — keep as default import so the ESM worker
    // bundle externalizes it (bare require() becomes esbuild's broken __require).
    const composer = new (MailComposer as new (mail: typeof mailOptions) => {
      compile: () => {
        build: (cb: (err: Error | null, message: Buffer) => void) => void;
      };
    })(mailOptions);
    composer.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
