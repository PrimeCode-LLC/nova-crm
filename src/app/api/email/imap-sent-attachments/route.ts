import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import { listLeadMailMessagesServer, upsertLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import {
  fetchImapSentAttachmentsByMessageIdsServer,
  toImapSentAttachmentsErrorMessage,
} from "@/lib/email/imap-fetch-sent-attachments-server";
import { sanitizeLeadMailAttachments } from "@/lib/email/lead-mail-attachments";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

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
    const leadId = String(b.leadId ?? "").trim();
    const messageIds = Array.isArray(b.messageIds)
      ? b.messageIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    const imap = b.imap as Record<string, unknown> | undefined;

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
    if (!mailboxId || messageIds.length === 0) {
      return NextResponse.json({ ok: false, error: "mailboxId and messageIds are required." }, { status: 400 });
    }

    const auth = await resolveMailboxTransportAuthServer({
      organizationId: g.ctx.session.organizationId,
      uid: resolved.dataOwnerUid,
      mailboxId,
      fallbackUser: String(imap?.user ?? "").trim(),
      fallbackPass: String(imap?.pass ?? ""),
      prefer: "imap",
    });
    const host = normalizeMailHost(String(imap?.host ?? ""));
    if (!host || !auth.user) {
      return NextResponse.json({ ok: false, error: "IMAP host and username are required." }, { status: 400 });
    }
    if (!auth.accessToken && !auth.pass) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
        },
        { status: 400 },
      );
    }

    const updates = await fetchImapSentAttachmentsByMessageIdsServer({
      host,
      port: Number(imap?.port ?? 993),
      secure: Boolean(imap?.secure ?? true),
      user: auth.user,
      pass: auth.pass,
      accessToken: auth.accessToken,
      messageIds,
    });

    if (leadId && updates.length > 0) {
      try {
        const existing = await listLeadMailMessagesServer({
          organizationId: g.ctx.session.organizationId,
          leadId,
        });
        const providerKeyByMessageId = new Map<string, string>();
        for (const row of existing) {
          if (row.direction !== "outbound" || row.mailboxId !== mailboxId) continue;
          const messageId = normalizeMessageId(row.messageId);
          if (messageId && !providerKeyByMessageId.has(messageId)) {
            providerKeyByMessageId.set(messageId, row.providerKey);
          }
        }
        await upsertLeadMailMessagesServer({
          organizationId: g.ctx.session.organizationId,
          leadId,
          mailboxOwnerUid: resolved.dataOwnerUid,
          messages: updates.map((update) => ({
            mailboxId,
            mailboxOwnerUid: resolved.dataOwnerUid,
            direction: "outbound" as const,
            providerKey:
              providerKeyByMessageId.get(update.messageId) ||
              leadMailProviderKey({
                mailboxId,
                direction: "outbound",
                localId: update.messageId,
              }),
            uid: update.uid,
            subject: "",
            from: "",
            to: "",
            date: "",
            messageId: update.messageId,
            attachments: sanitizeLeadMailAttachments(update.attachments) ?? [],
            source: "client_sync" as const,
          })),
          refreshSummary: false,
        });
      } catch {
        /* client still receives updates for the open thread */
      }
    }

    return NextResponse.json({
      ok: true,
      updates: updates.map((update) => ({
        messageId: update.messageId,
        uid: update.uid,
        attachments: sanitizeLeadMailAttachments(update.attachments) ?? update.attachments,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: toImapSentAttachmentsErrorMessage(e) }, { status: 400 });
  }
}
