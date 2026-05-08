import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

const MAX_UIDS_PER_REQUEST = 80;
const CHUNK = 40;

function normalizeUids(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_UIDS_PER_REQUEST);
}

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "").trim();
    const imap = b.imap as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const uids = normalizeUids(b.uids);

    if (!action || (action !== "moveInboxToTrash" && action !== "permanentDeleteTrash")) {
      return NextResponse.json(
        { ok: false, error: "Invalid action. Use moveInboxToTrash or permanentDeleteTrash." },
        { status: 400 },
      );
    }
    if (uids.length === 0) {
      return NextResponse.json({ ok: false, error: "Provide a non-empty uids array." }, { status: 400 });
    }

    const host = normalizeMailHost(String(imap?.host ?? ""));
    const port = Number(imap?.port ?? 993);
    const secure = Boolean(imap?.secure);
    let user = String(imap?.user ?? "").trim();
    let pass = String(imap?.pass ?? "");
    if (mailboxId) {
      const secrets = await getMailboxSecretsServer({
        organizationId: g.ctx.session.organizationId,
        uid: g.ctx.session.uid,
        mailboxId,
      });
      if (secrets) {
        const fromVault = secrets.imap.user.trim();
        if (fromVault) user = fromVault;
        if (secrets.imap.password) pass = secrets.imap.password;
      }
    }

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "IMAP host and username are required." },
        { status: 400 },
      );
    }

    const client = new ImapFlow(
      imapFlowConnectionOptions({ host, port, secure, user, pass, purpose: "fetch" }),
    );
    client.on("error", () => undefined);

    await client.connect();

    try {
      const trashPath = await resolveTrashMailboxPath(client);
      if (!trashPath) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not find a Trash folder on the server. Check that your account exposes a standard Trash / Deleted Items mailbox.",
          },
          { status: 400 },
        );
      }

      if (action === "moveInboxToTrash") {
        const lock = await client.getMailboxLock("INBOX", { readOnly: false });
        try {
          for (let i = 0; i < uids.length; i += CHUNK) {
            const part = uids.slice(i, i + CHUNK);
            const moved = await client.messageMove(part, trashPath, { uid: true });
            if (moved === false) {
              return NextResponse.json(
                { ok: false, error: "The mail server rejected moving one or more messages to Trash." },
                { status: 400 },
              );
            }
          }
        } finally {
          try {
            lock.release();
          } catch {
            /* ignore */
          }
        }
        return NextResponse.json({ ok: true, trashPath });
      }

      /* permanentDeleteTrash */
      const lock = await client.getMailboxLock(trashPath, { readOnly: false });
      try {
        for (let i = 0; i < uids.length; i += CHUNK) {
          const part = uids.slice(i, i + CHUNK);
          const ok = await client.messageDelete(part, { uid: true });
          if (!ok) {
            return NextResponse.json(
              { ok: false, error: "The mail server rejected permanently deleting one or more messages." },
              { status: 400 },
            );
          }
        }
      } finally {
        try {
          lock.release();
        } catch {
          /* ignore */
        }
      }
      return NextResponse.json({ ok: true, trashPath });
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatImapError(e) }, { status: 400 });
  }
}
