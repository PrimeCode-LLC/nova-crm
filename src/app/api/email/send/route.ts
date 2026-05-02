import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const smtp = b.smtp as Record<string, unknown> | undefined;
    const host = String(smtp?.host ?? "").trim();
    const port = Number(smtp?.port ?? 587);
    const secure = Boolean(smtp?.secure);
    const user = String(smtp?.user ?? "").trim();
    const pass = String(smtp?.pass ?? "");
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

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

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
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
