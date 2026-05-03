import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const host = String(b.host ?? "").trim();
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

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: false,
    });

    await client.connect();
    await client.logout();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "IMAP verification failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
