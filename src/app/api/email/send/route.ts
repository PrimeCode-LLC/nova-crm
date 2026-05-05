import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError, smtpTransportOptions } from "@/lib/email/smtp-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const smtp = b.smtp as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(smtp?.host ?? ""));
    const port = Number(smtp?.port ?? 587);
    const secure = Boolean(smtp?.secure);
    let user = String(smtp?.user ?? "").trim();
    let pass = String(smtp?.pass ?? "");
    if (mailboxId) {
      const secrets = await getMailboxSecretsServer({
        organizationId: g.ctx.session.organizationId,
        uid: g.ctx.session.uid,
        mailboxId,
      });
      if (secrets) {
        const fromVault = secrets.smtp.user.trim();
        if (fromVault) user = fromVault;
        if (secrets.smtp.password) pass = secrets.smtp.password;
      }
    }
    const from = String(b.from ?? "").trim();
    const displayName = String(b.displayName ?? "").trim();
    const replyTo = String(b.replyTo ?? "").trim();
    const to = String(b.to ?? "").trim();
    const subject = String(b.subject ?? "").trim();
    const text = String(b.text ?? "");
    const html = String(b.html ?? "");

    if (!host || !user || !from || !to) {
      return NextResponse.json(
        { ok: false, error: "SMTP host, user, from, and recipient are required." },
        { status: 400 },
      );
    }

    const transporter = nodemailer.createTransport(
      smtpTransportOptions({ host, port, secure, user, pass }),
    );

    const fromHeader = displayName ? `"${displayName.replace(/"/g, "")}" <${from}>` : from;

    await transporter.sendMail({
      from: fromHeader,
      to,
      subject: subject || "(no subject)",
      text: text || undefined,
      html: html || undefined,
      replyTo: replyTo || undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatSmtpError(e) }, { status: 400 });
  }
}
