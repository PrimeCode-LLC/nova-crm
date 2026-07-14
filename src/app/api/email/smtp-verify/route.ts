import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 587);
    const secure = Boolean(b.secure);
    const auth = await resolveMailboxTransportAuthServer({
      organizationId: g.ctx.session.organizationId,
      uid: g.ctx.session.uid,
      mailboxId,
      fallbackUser: String(b.user ?? "").trim(),
      fallbackPass: String(b.pass ?? ""),
      prefer: "smtp",
    });

    if (!host || !auth.user) {
      return NextResponse.json(
        { ok: false, error: "Host and username are required." },
        { status: 400 },
      );
    }
    if (!auth.accessToken && !auth.pass) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Password missing. For Google Workspace, use Sign in with Google first (preferred passwords no longer work for SMTP).",
        },
        { status: 400 },
      );
    }

    await runWithSmtpTransporter(
      host,
      {
        port,
        secure,
        user: auth.user,
        pass: auth.pass,
        accessToken: auth.accessToken,
      },
      async (transporter) => transporter.verify(),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatSmtpError(e) }, { status: 400 });
  }
}
