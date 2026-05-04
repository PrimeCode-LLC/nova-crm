import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError, smtpTransportOptions } from "@/lib/email/smtp-client-options";

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

    const transporter = nodemailer.createTransport(
      smtpTransportOptions({ host, port, secure, user, pass }),
    );

    await transporter.verify();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatSmtpError(e) }, { status: 400 });
  }
}
