import nodemailer from "nodemailer";

export type SystemEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

function systemFromAddress(): string | undefined {
  return (
    process.env.RESEND_FROM?.trim() ||
    process.env.SYSTEM_SMTP_FROM?.trim() ||
    process.env.SYSTEM_SMTP_USER?.trim()
  );
}

async function sendViaResend(
  input: SystemEmailInput,
  apiKey: string,
  from: string,
): Promise<
  { ok: true } | { ok: false; reason: "send_failed"; error: string }
> {
  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.replyTo) {
    body.reply_to = input.replyTo;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    let detail = await res.text();
    try {
      const j = JSON.parse(detail) as { message?: string };
      if (j.message) detail = j.message;
    } catch {
      /* keep raw */
    }
    return {
      ok: false,
      reason: "send_failed",
      error: detail.slice(0, 500) || `HTTP ${res.status}`,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "send_failed", error };
  }
}

/**
 * Send a transactional email. Tries in order:
 * 1. **SYSTEM_SMTP_*** (nodemailer) when host, user, pass, and from-address are available
 * 2. **RESEND_API_KEY** + from (`RESEND_FROM` or `SYSTEM_SMTP_FROM`) via Resend HTTP API
 *
 * Separate from per-user SMTP used for cold outbound. If nothing is configured,
 * resolves with `{ ok: false, reason: "not_configured" }` so callers can fall back
 * (e.g. show the accept link for manual sharing).
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
  const smtpFrom = process.env.SYSTEM_SMTP_FROM ?? user;
  const port = Number(process.env.SYSTEM_SMTP_PORT ?? 587);
  const secure = process.env.SYSTEM_SMTP_SECURE === "true";

  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (host && user && pass && smtpFrom) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      await transporter.sendMail({
        from: smtpFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (resendKey) {
        const from = systemFromAddress();
        if (!from) {
          return {
            ok: false,
            reason: "send_failed",
            error: `SMTP failed (${error}) and Resend sender is missing`,
          };
        }
        const resend = await sendViaResend(input, resendKey, from);
        if (resend.ok) return resend;
        return {
          ok: false,
          reason: "send_failed",
          error: `SMTP failed (${error}); Resend failed (${resend.error})`,
        };
      }
      return { ok: false, reason: "send_failed", error };
    }
  }

  if (resendKey) {
    const from = systemFromAddress();
    if (!from) {
      return { ok: false, reason: "not_configured" };
    }
    return sendViaResend(input, resendKey, from);
  }

  return { ok: false, reason: "not_configured" };
}

/** Hint for operators when outbound mail is not configured. */
export function systemEmailConfigHint(): string {
  return (
    "Configure SYSTEM_SMTP_HOST, SYSTEM_SMTP_USER, SYSTEM_SMTP_PASS, and SYSTEM_SMTP_FROM, " +
    "or set RESEND_API_KEY and RESEND_FROM (or SYSTEM_SMTP_FROM)."
  );
}
