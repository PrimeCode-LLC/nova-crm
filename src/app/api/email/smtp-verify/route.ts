import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const host = normalizeMailHost(String(b.host ?? ""));
    const port = Number(b.port ?? 587);
    const secure = Boolean(b.secure);
    const user = String(b.user ?? "").trim();
    const pass = String(b.pass ?? "");

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "Host and username are required." },
        { status: 400 },
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    await transporter.verify();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMTP verification failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
