import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 993);
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
        const fromVault = secrets.imap.user.trim();
        if (fromVault) user = fromVault;
        if (secrets.imap.password) pass = secrets.imap.password;
      }
    }

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "Host and username are required." },
        { status: 400 },
      );
    }

    const client = new ImapFlow(imapFlowConnectionOptions({ host, port, secure, user, pass }));

    await client.connect();
    await client.logout();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatImapError(e) }, { status: 400 });
  }
}
