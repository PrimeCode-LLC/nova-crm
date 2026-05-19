import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 587);
    const secure = Boolean(b.secure);
    let user = String(b.user ?? "").trim();
    let pass = String(b.pass ?? "");
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

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "Host and username are required." },
        { status: 400 },
      );
    }

    await runWithSmtpTransporter(host, { port, secure, user, pass }, async (transporter) =>
      transporter.verify(),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatSmtpError(e) }, { status: 400 });
  }
}
