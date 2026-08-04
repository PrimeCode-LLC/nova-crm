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
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { resolvePendingReplyActionOnOutboundServer } from "@/lib/email/resolve-pending-reply-action-on-outbound-server";

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
    const bcc = String(b.bcc ?? "").trim();
    const subject = String(b.subject ?? "").trim();
    const text = String(b.text ?? "");
    const html = String(b.html ?? "");
    const leadId = String(b.leadId ?? "").trim() || undefined;
    const inReplyTo = normalizeMessageId(String(b.inReplyTo ?? ""));
    const referenceIds = Array.isArray(b.referenceIds)
      ? b.referenceIds
          .map((value) => normalizeMessageId(String(value ?? "")))
          .filter((value): value is string => Boolean(value))
          .slice(-50)
      : undefined;
    const parsedAttachments = parseOutboundAttachments(b.attachments);
    if ("error" in parsedAttachments) {
      return NextResponse.json({ ok: false, error: parsedAttachments.error }, { status: 400 });
    }
    const contactPolicy = await assertLeadContactAllowedServer({
      organizationId: g.ctx.session.organizationId,
      leadId,
    });
    if (!contactPolicy.ok) {
      return NextResponse.json(
        { ok: false, error: contactPolicy.error },
        { status: contactPolicy.status },
      );
    }

    let connectionType: string | undefined;
    let trackOpens = false;
    let trackClicks = false;
    if (mailboxId) {
      const profile = await getMailboxProfileServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
      });
      connectionType = profile?.connectionType;
      trackOpens = Boolean(profile?.readReceipts);
      trackClicks = Boolean(profile?.trackClicks);
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
      appendSentCopy:
        connectionType === "google_workspace" || connectionType === "microsoft_outlook"
          ? false
          : undefined,
      from,
      displayName,
      replyTo,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      inReplyTo,
      referenceIds,
      attachments: parsedAttachments,
      tracking: {
        trackOpens,
        trackClicks,
        leadId,
      },
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

    if (leadId && mailboxId) {
      await persistOutboundLeadMailServer({
        organizationId: g.ctx.session.organizationId,
        leadId,
        mailboxId,
        mailboxOwnerUid: dataOwnerUid,
        from,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        replyTo: replyTo || undefined,
        subject,
        bodyText: text || html,
        bodyHtml: html || undefined,
        sentAt: new Date().toISOString(),
        messageId: result.messageId,
        inReplyTo: inReplyTo || undefined,
        referenceIds,
        source: "smtp_send",
      });
    }

    if (leadId) {
      try {
        await resolvePendingReplyActionOnOutboundServer({
          organizationId: g.ctx.session.organizationId,
          leadId,
          decidedBy: g.ctx.session.uid,
          messageId: result.messageId,
        });
      } catch {
        /* Delivery succeeded; reply-intelligence cleanup can recover on next sync. */
      }
    }

    return NextResponse.json({
      ok: true,
      sentSavedToMailbox: result.sentSavedToMailbox,
      messageId: result.messageId,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
}
