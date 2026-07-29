import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import { recordMailboxTransportHealthServer } from "@/lib/email/inbox-heads-server";

export async function POST(req: Request) {
  let organizationId = "";
  let uid = "";
  let mailboxId = "";
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    organizationId = g.ctx.session.organizationId;
    uid = g.ctx.session.uid;

    const b = (await req.json()) as Record<string, unknown>;
    mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 587);
    const secure = Boolean(b.secure);
    const auth = await resolveMailboxTransportAuthServer({
      organizationId,
      uid,
      mailboxId,
      fallbackUser: String(b.user ?? "").trim(),
      fallbackPass: String(b.pass ?? ""),
      prefer: "smtp",
    });

    if (!host || !auth.user) {
      const error = "Host and username are required.";
      if (mailboxId) {
        await recordMailboxTransportHealthServer({
          organizationId,
          uid,
          mailboxId,
          ok: false,
          error,
        });
      }
      return NextResponse.json({ ok: false, error, transportError: error }, { status: 400 });
    }
    if (!auth.accessToken && !auth.pass) {
      const error =
        "Password missing. For Google Workspace, use Sign in with Google first (preferred passwords no longer work for SMTP).";
      if (mailboxId) {
        await recordMailboxTransportHealthServer({
          organizationId,
          uid,
          mailboxId,
          ok: false,
          error,
        });
      }
      return NextResponse.json({ ok: false, error, transportError: error }, { status: 400 });
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
    if (mailboxId) {
      await recordMailboxTransportHealthServer({
        organizationId,
        uid,
        mailboxId,
        ok: true,
      });
    }
    return NextResponse.json({ ok: true, transportError: null });
  } catch (e) {
    const error = formatSmtpError(e);
    if (mailboxId) {
      await recordMailboxTransportHealthServer({
        organizationId,
        uid,
        mailboxId,
        ok: false,
        error,
      });
    }
    return NextResponse.json({ ok: false, error, transportError: error }, { status: 400 });
  }
}
