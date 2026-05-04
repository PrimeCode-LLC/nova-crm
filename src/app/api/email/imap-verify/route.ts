import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 993);
    const secure = Boolean(b.secure);
    const user = String(b.user ?? "").trim();
    const pass = String(b.pass ?? "");

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
