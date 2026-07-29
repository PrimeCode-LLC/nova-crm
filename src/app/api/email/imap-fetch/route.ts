import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveMailboxTransportAuthServer, googleAuthFailureMessage } from "@/lib/email/resolve-mailbox-transport-auth";
import {
  fetchImapFolderServer,
  IMAP_FETCH_DEFAULT_LIMIT,
  IMAP_FETCH_MAX_LIMIT,
  toImapFetchErrorMessage,
  type ImapFolderKind,
} from "@/lib/email/imap-fetch-folder-server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const forUser = new URL(req.url).searchParams.get("forUser");
    const b = (await req.json()) as Record<string, unknown>;
    const imap = b.imap as Record<string, unknown> | undefined;
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
    const dataOwnerUid = resolved.dataOwnerUid;
    let host = normalizeMailHost(String(imap?.host ?? ""));
    const port = Number(imap?.port ?? 993);
    const secure = Boolean(imap?.secure ?? true);
    const auth = await resolveMailboxTransportAuthServer({
      organizationId: g.ctx.session.organizationId,
      uid: dataOwnerUid,
      mailboxId,
      fallbackUser: String(imap?.user ?? "").trim(),
      fallbackPass: String(imap?.pass ?? ""),
      prefer: "imap",
    });
    let user = auth.user;
    const pass = auth.pass;
    const accessToken = auth.accessToken;

    if ((!host || !user) && mailboxId) {
      const profile = await getMailboxProfileServer({
        organizationId: g.ctx.session.organizationId,
        uid: dataOwnerUid,
        mailboxId,
      });
      if (profile) {
        if (!host) host = normalizeMailHost(profile.imap.host);
        if (!user) user = profile.emailAddress.trim() || profile.imap.user.trim();
      }
    }

    const requested = Number(b.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(IMAP_FETCH_MAX_LIMIT, Math.floor(requested))
        : IMAP_FETCH_DEFAULT_LIMIT;

    const requestedOffset = Number(b.offset);
    const offset =
      Number.isFinite(requestedOffset) && requestedOffset > 0
        ? Math.min(Math.floor(requestedOffset), 10_000_000)
        : 0;

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
          error: googleAuthFailureMessage(auth.googleAuthFailure),
          googleAuthFailure: auth.googleAuthFailure ?? "no_tokens",
        },
        { status: 400 },
      );
    }

    const folderRaw = String(b.folder ?? "inbox").toLowerCase();
    const folder: ImapFolderKind =
      folderRaw === "trash" ? "trash" : folderRaw === "sent" ? "sent" : "inbox";

    const result = await fetchImapFolderServer({
      host,
      port,
      secure,
      user,
      pass,
      accessToken,
      folder,
      limit,
      offset,
      headsOnly: Boolean(b.headsOnly),
    });

    return NextResponse.json({
      ok: true,
      messages: result.messages,
      mailboxTotal: result.mailboxTotal,
      offset: result.offset,
      loadedThrough: result.loadedThrough,
      mailboxPath: result.mailboxPath,
      skippedNoEnvelope: result.skippedNoEnvelope,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: toImapFetchErrorMessage(e) }, { status: 400 });
  }
}
