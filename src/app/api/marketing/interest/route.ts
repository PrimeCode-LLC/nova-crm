import { NextResponse } from "next/server";
import { z } from "zod";
import {
  sendSystemEmail,
  systemEmailConfigHint,
} from "@/lib/email/send-system-email";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";

const bodySchema = z.object({
  type: z.enum(["waitlist", "contact"]).default("waitlist"),
  email: z.string().email().max(320),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
  teamSize: z.string().trim().max(80).optional(),
  message: z.string().trim().max(4000).optional(),
  /** Honeypot — bots fill this; humans leave it empty. */
  website: z.string().max(200).optional(),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please provide a valid work email." },
      { status: 400 },
    );
  }

  const data = parsed.data;
  if (data.website?.trim()) {
    // Silent success for bots.
    return NextResponse.json({ ok: true });
  }

  if (data.type === "contact" && !data.message?.trim()) {
    return NextResponse.json(
      { error: "Please include a short message." },
      { status: 400 },
    );
  }

  const email = data.email.trim().toLowerCase();
  const name = data.name?.trim() || "";
  const company = data.company?.trim() || "";
  const teamSize = data.teamSize?.trim() || "";
  const message = data.message?.trim() || "";
  const isWaitlist = data.type === "waitlist";

  const subject = isWaitlist
    ? `[Nova waitlist] ${email}${company ? ` · ${company}` : ""}`
    : `[Nova contact] ${name || email}${company ? ` · ${company}` : ""}`;

  const lines = [
    isWaitlist ? "New Nova waitlist interest" : "New Nova contact inquiry",
    "",
    `Email: ${email}`,
    name ? `Name: ${name}` : null,
    company ? `Company: ${company}` : null,
    teamSize ? `Team size: ${teamSize}` : null,
    message ? `Message:\n${message}` : null,
    "",
    `Source: ${SITE.url}`,
    `Received: ${new Date().toISOString()}`,
  ].filter((line): line is string => line !== null);

  const text = lines.join("\n");
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">${isWaitlist ? "Nova waitlist interest" : "Nova contact inquiry"}</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${escapeHtml(email)}</td></tr>
        ${name ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>${escapeHtml(name)}</td></tr>` : ""}
        ${company ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Company</td><td>${escapeHtml(company)}</td></tr>` : ""}
        ${teamSize ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Team size</td><td>${escapeHtml(teamSize)}</td></tr>` : ""}
      </table>
      ${
        message
          ? `<p style="margin:16px 0 0;white-space:pre-wrap">${escapeHtml(message)}</p>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:12px;color:#888">Source: ${escapeHtml(SITE.url)}</p>
    </div>
  `;

  const send = await sendSystemEmail({
    to: SITE.salesEmail,
    subject,
    text,
    html,
    replyTo: email,
  });

  if (!send.ok) {
    console.error("Marketing interest email failed", {
      reason: send.reason,
      error: send.error,
      hint: send.reason === "not_configured" ? systemEmailConfigHint() : undefined,
    });
    return NextResponse.json(
      {
        error:
          send.reason === "not_configured"
            ? "Interest intake is temporarily unavailable. Email sales@stellixsoft.com directly."
            : "Could not send your request. Please try again or email sales@stellixsoft.com.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
