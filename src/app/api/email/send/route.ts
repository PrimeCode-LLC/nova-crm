import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";
import { resolveMailboxDataOwnerUid, canMailboxSend } from "@/lib/email/mailbox-data-owner-server";
import { parseOutboundAttachments } from "@/lib/email/outbound-attachments";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import {
  assertMailboxDailySendQuotaServer,
  incrementMailboxSendCountServer,
} from "@/lib/email/mailbox-send-quota-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const forUser = new URL(req.url).searchParams.get("forUser");
    let b: Record<string, unknown>;
    try {
      b = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const mailboxId = String(b.mailboxId ?? "").trim();
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
      mailboxId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }
    if (!canMailboxSend(resolved)) {
      return NextResponse.json(
        {
          ok: false,
          error: "You can view this mailbox but cannot send mail on behalf of another member.",
        },
        { status: 403 },
      );
    }
    const dataOwnerUid = resolved.dataOwnerUid;

    const smtp = b.smtp as Record<string, unknown> | undefined;
    const imap = b.imap as Record<string, unknown> | undefined;
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

    if (mailboxId) {
      const profile = await getMailboxProfileServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
      });
      const quota = await assertMailboxDailySendQuotaServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
        dailySendLimit: profile?.dailySendLimit ?? null,
      });
      if (!quota.ok) {
        return NextResponse.json(
          { ok: false, error: quota.error, used: quota.used, limit: quota.limit },
          { status: quota.status },
        );
      }
    }

    const imapHost = normalizeMailHost(String(imap?.host ?? ""));
    const result = await sendOutboundMailServer({
      organizationId: g.ctx.session.organizationId,
      uid: dataOwnerUid,
      mailboxId,
      smtp: { host, port, secure, user, pass },
      imap: imapHost
        ? {
            host: imapHost,
            port: Number(imap?.port ?? 993),
            secure: Boolean(imap?.secure),
            user: String(imap?.user ?? ""),
            pass: String(imap?.pass ?? ""),
          }
        : undefined,
      from,
      displayName,
      replyTo,
      to,
      cc,
      subject,
      text,
      html,
      attachments: parsedAttachments,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    if (mailboxId) {
      await incrementMailboxSendCountServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
      });
    }

    return NextResponse.json({ ok: true, sentSavedToMailbox: result.sentSavedToMailbox });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
}
