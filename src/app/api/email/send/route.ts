import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatSmtpError } from "@/lib/email/smtp-client-options";
import { runWithSmtpTransporter } from "@/lib/email/smtp-connect-retry";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";

const MAX_OUTBOUND_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type OutboundAttachment = { filename: string; content: Buffer; contentType: string };

function parseOutboundAttachments(raw: unknown): OutboundAttachment[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };

  const out: OutboundAttachment[] = [];
  for (const item of raw.slice(0, MAX_OUTBOUND_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const filename = String(rec.filename ?? "attachment").trim() || "attachment";
    const contentBase64 = String(rec.contentBase64 ?? "").trim();
    if (!contentBase64) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(contentBase64, "base64");
    } catch {
      return { error: `Invalid attachment data for ${filename}` };
    }
    if (!buf.length) continue;
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return { error: `${filename} exceeds the 10 MB per-file limit` };
    }
    const contentType = String(rec.mimeType ?? rec.contentType ?? "application/octet-stream").trim();
    out.push({ filename, content: buf, contentType: contentType || "application/octet-stream" });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const forUser = new URL(req.url).searchParams.get("forUser");
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }
    if (!resolved.viewerIsMailboxOwner) {
      return NextResponse.json(
        {
          ok: false,
          error: "You can view this mailbox but cannot send mail on behalf of another member.",
        },
        { status: 403 },
      );
    }
    const dataOwnerUid = resolved.dataOwnerUid;

    const b = (await req.json()) as Record<string, unknown>;
    const smtp = b.smtp as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(smtp?.host ?? ""));
    const port = Number(smtp?.port ?? 587);
    const secure = Boolean(smtp?.secure);
    let user = String(smtp?.user ?? "").trim();
    let pass = String(smtp?.pass ?? "");
    if (mailboxId) {
      const secrets = await getMailboxSecretsServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
      });
      if (secrets) {
        const fromVault = secrets.smtp.user.trim();
        if (fromVault) user = fromVault;
        if (secrets.smtp.password) pass = secrets.smtp.password;
      }
    }
    const from = String(b.from ?? "").trim();
    const displayName = String(b.displayName ?? "").trim();
    const replyTo = String(b.replyTo ?? "").trim();
    const to = String(b.to ?? "").trim();
    const cc = String(b.cc ?? "").trim();
    const subject = String(b.subject ?? "").trim();
    const text = String(b.text ?? "");
    const html = String(b.html ?? "");
    const parsedAttachments = parseOutboundAttachments(b.attachments);
    if ("error" in parsedAttachments) {
      return NextResponse.json({ ok: false, error: parsedAttachments.error }, { status: 400 });
    }

    if (!host || !user || !from || !to) {
      return NextResponse.json(
        { ok: false, error: "SMTP host, user, from, and recipient are required." },
        { status: 400 },
      );
    }

    const fromHeader = displayName ? `"${displayName.replace(/"/g, "")}" <${from}>` : from;

    await runWithSmtpTransporter(
      host,
      { port, secure, user, pass },
      async (transporter) =>
        transporter.sendMail({
          from: fromHeader,
          to,
          cc: cc || undefined,
          subject: subject || "(no subject)",
          text: text || undefined,
          html: html || undefined,
          replyTo: replyTo || undefined,
          attachments:
            parsedAttachments.length > 0
              ? parsedAttachments.map((att) => ({
                  filename: att.filename,
                  content: att.content,
                  contentType: att.contentType,
                }))
              : undefined,
        }),
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatSmtpError(e) }, { status: 400 });
  }
}
