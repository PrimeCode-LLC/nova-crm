import nodemailer from "nodemailer";

export type SystemEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

/**
 * Send a transactional email using SYSTEM_SMTP_* env vars. This is separate
 * from the per-user SMTP setup used for cold outbound. If env is missing,
 * the call resolves with `{ ok: false, reason: "not_configured" }` so the
 * caller can decide what to do (e.g. log the link for manual delivery).
 */
export async function sendSystemEmail(
  input: SystemEmailInput,
): Promise<
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string }
> {
  const host = process.env.SYSTEM_SMTP_HOST;
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;
  const from = process.env.SYSTEM_SMTP_FROM ?? user;
  const port = Number(process.env.SYSTEM_SMTP_PORT ?? 587);
  const secure = process.env.SYSTEM_SMTP_SECURE === "true";

  if (!host || !user || !pass || !from) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "send_failed", error };
  }
}
