import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import type { ImapFolderKind } from "@/lib/email/imap-fetch-folder-server";
import {
  fetchImapAttachmentServer,
  toImapAttachmentErrorMessage,
} from "@/lib/email/imap-fetch-attachment-server";

function contentDisposition(filename: string, inline: boolean): string {
  const safe = filename.replace(/[\r\n"]/g, "_") || "attachment";
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${safe}"`;
}

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
    const uid = Number(b.uid);
    const filename = String(b.filename ?? "").trim();
    const index = b.index == null ? undefined : Number(b.index);
    const inline = b.inline === true;
    const folderRaw = String(b.folder ?? "inbox").toLowerCase();
    const folder: ImapFolderKind =
      folderRaw === "trash" ? "trash" : folderRaw === "sent" ? "sent" : "inbox";
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

    const file = await fetchImapAttachmentServer({
      host,
      port: Number(imap?.port ?? 993),
      secure: Boolean(imap?.secure ?? true),
      user: auth.user,
      pass: auth.pass,
      accessToken: auth.accessToken,
      folder,
      uid,
      filename: filename || undefined,
      index,
    });
    if (!file) {
      return NextResponse.json({ ok: false, error: "Attachment not found on the server copy." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition(file.filename, inline),
        "Cache-Control": "private, no-store",
        "X-Attachment-Filename": encodeURIComponent(file.filename),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: toImapAttachmentErrorMessage(e) }, { status: 400 });
  }
}
