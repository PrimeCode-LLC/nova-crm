import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";
import { resolveMailboxDataOwnerUid, canMailboxSend } from "@/lib/email/mailbox-data-owner-server";
import { outboundAttachmentsToLeadMail } from "@/lib/email/lead-mail-attachments";
import { parseOutboundAttachments } from "@/lib/email/outbound-attachments";
import { sendOutboundMailServer } from "@/lib/email/send-outbound-mail-server";
import {
  reserveMailboxDailySendServer,
  releaseMailboxDailySendServer,
} from "@/lib/email/mailbox-send-quota-server";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";
import { persistOutboundLeadMailServer } from "@/lib/email/persist-outbound-lead-mail-server";
import { isSuppressed } from "@/lib/email/suppression-server";
import { recordEmailSendEventServer } from "@/lib/email/record-email-send-event-server";
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
    // A saved mailbox always sends with its own server settings: the request
    // must not be able to send the vault credentials to another host (QA 1.5).
    const profile = mailboxId
      ? await getMailboxProfileServer({
          organizationId: g.ctx.session.organizationId,
          uid: dataOwnerUid,
          mailboxId,
        })
      : null;
    if (mailboxId && !profile) {
      return NextResponse.json({ ok: false, error: "Mailbox not found." }, { status: 404 });
    }
    if (profile && profile.enabled === false) {
      return NextResponse.json(
        { ok: false, error: "This mailbox is disabled. Enable it in Settings to send." },
        { status: 409 },
      );
    }
    const host = normalizeMailHost(profile ? profile.smtp.host : String(smtp?.host ?? ""));
    const port = profile ? profile.smtp.port : Number(smtp?.port ?? 587);
    const secure = profile ? profile.smtp.secure : Boolean(smtp?.secure);
    let user = String(smtp?.user ?? "").trim();
    let pass = String(smtp?.pass ?? "");
    if (profile) {
      const fromVault = profile.smtp.user.trim();
      if (fromVault) user = fromVault;
      if (profile.smtp.password) pass = profile.smtp.password;
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

    const recipients = [to, cc, bcc]
      .flatMap((list) => list.split(/[,;]/))
      .map((addr) => (addr.match(/<([^>]+)>/)?.[1] ?? addr).trim())
      .filter(Boolean);
    for (const email of recipients) {
      if (await isSuppressed({ organizationId: g.ctx.session.organizationId, email })) {
        return NextResponse.json(
          {
            ok: false,
            error: `${email} has unsubscribed or bounced and cannot be emailed.`,
            code: "recipient_suppressed",
          },
          { status: 409 },
        );
      }
    }

    const connectionType = profile?.connectionType;
    const trackOpens = Boolean(profile?.readReceipts);
    const trackClicks = Boolean(profile?.trackClicks);
    let reservedSend = false;
    let reservedMailboxId = "";
    if (profile) {
      const quota = await reserveMailboxDailySendServer({
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
      reservedSend = true;
      reservedMailboxId = mailboxId;
    }

    const imapHost = normalizeMailHost(profile ? profile.imap.host : String(imap?.host ?? ""));
    const result = await sendOutboundMailServer({
      organizationId: g.ctx.session.organizationId,
      uid: dataOwnerUid,
      mailboxId,
      smtp: { host, port, secure, user, pass },
      imap: imapHost
        ? {
            host: imapHost,
            port: profile ? profile.imap.port : Number(imap?.port ?? 993),
            secure: profile ? profile.imap.secure : Boolean(imap?.secure),
            user: profile?.imap.user || String(imap?.user ?? ""),
            pass: profile?.imap.password || String(imap?.pass ?? ""),
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
      if (reservedSend && reservedMailboxId) {
        await releaseMailboxDailySendServer({
          organizationId: g.ctx.session.organizationId,
          uid: dataOwnerUid,
          mailboxId: reservedMailboxId,
        }).catch(() => null);
      }
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
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
        attachments: outboundAttachmentsToLeadMail(parsedAttachments),
        source: "smtp_send",
      });
    }

    try {
      await recordEmailSendEventServer({
        organizationId: g.ctx.session.organizationId,
        actorId: g.ctx.session.uid,
        source: "smtp_send",
        mailboxId: mailboxId || undefined,
        leadId,
        messageId: result.messageId,
        subject,
        writeTimeline: Boolean(leadId),
      });
    } catch {
      /* send already succeeded; dashboard count can catch up on next recompute */
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
