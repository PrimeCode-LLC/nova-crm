import { NextResponse } from "next/server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import {
  fetchImapBodiesServer,
  toImapBodiesErrorMessage,
} from "@/lib/email/imap-fetch-bodies-server";
import type { ImapFolderKind } from "@/lib/email/imap-fetch-folder-server";
import { persistImapBodiesToLeadMailServer } from "@/lib/email/fanout-inbox-to-lead-mail-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const forUser = new URL(req.url).searchParams.get("forUser");
    const b = (await req.json()) as Record<string, unknown>;
    const imap = b.imap as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const uidsRaw = b.uids;
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
    const dataOwnerUid = resolved.dataOwnerUid;

    const uids = Array.isArray(uidsRaw)
      ? uidsRaw
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];

    if (uids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Provide uids (non-empty array of IMAP UID numbers)." },
        { status: 400 },
      );
    }

    const host = normalizeMailHost(String(imap?.host ?? ""));
    const port = Number(imap?.port ?? 993);
    const secure = Boolean(imap?.secure);
    const auth = await resolveMailboxTransportAuthServer({
      organizationId: g.ctx.session.organizationId,
      uid: dataOwnerUid,
      mailboxId,
      fallbackUser: String(imap?.user ?? "").trim(),
      fallbackPass: String(imap?.pass ?? ""),
      prefer: "imap",
    });
    const user = auth.user;
    const pass = auth.pass;
    const accessToken = auth.accessToken;

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "IMAP host and username are required." },
        { status: 400 },
      );
    }
    if (!accessToken && !pass) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
        },
        { status: 400 },
      );
    }

    const folderRaw = String(b.folder ?? "inbox").toLowerCase();
    const folder: ImapFolderKind =
      folderRaw === "trash" ? "trash" : folderRaw === "sent" ? "sent" : "inbox";

    const updates = await fetchImapBodiesServer({
      host,
      port,
      secure,
      user,
      pass,
      accessToken,
      folder,
      uids,
    });

    // Durable lead thread store: persist lead-matched reply bodies when Inbox loads them.
    if (folder === "inbox" && mailboxId && updates.length > 0) {
      try {
        await persistImapBodiesToLeadMailServer({
          organizationId: g.ctx.session.organizationId,
          dataOwnerUid,
          mailboxId,
          folder,
          updates,
        });
      } catch {
        /* body response still useful; cron / Emails tab retry persistence */
      }
    }

    return NextResponse.json({ ok: true, updates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: toImapBodiesErrorMessage(e) }, { status: 400 });
  }
}
