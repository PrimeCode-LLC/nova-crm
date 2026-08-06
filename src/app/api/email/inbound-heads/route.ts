import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { listMailboxesForMemberServer } from "@/lib/email/mailbox-profiles-server";
import { readInboxHeadsServer } from "@/lib/email/inbox-heads-server";
import type { MailInbound } from "@/lib/email-account-types";

/** Cap parallel Firestore head reads so 19 mailboxes do not saturate Admin SDK. */
const HEADS_READ_CONCURRENCY = 3;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Reads cron-persisted IMAP inbox heads for the mailbox owner (or view-as owner).
 * Used by the client to hydrate Zustand without opening an IMAP connection.
 *
 * Query params:
 * - mailboxId: single mailbox (preferred off-Inbox)
 * - limit: max messages per mailbox in the response (newest first)
 */
export async function GET(req: Request) {
  const started = Date.now();
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const url = new URL(req.url);
    const forUser = url.searchParams.get("forUser");
    const mailboxIdFilter = (url.searchParams.get("mailboxId") ?? "").trim();
    const limitRaw = Number(url.searchParams.get("limit") ?? "");
    const messageLimit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 800) : null;

    const resolved = await resolveMailboxDataOwnerUid({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
      mailboxId: mailboxIdFilter || undefined,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }

    const mailboxes = await listMailboxesForMemberServer({
      organizationId: g.ctx.session.organizationId,
      uid: resolved.dataOwnerUid,
      includeSecrets: false,
    });
    const targets = mailboxIdFilter
      ? mailboxes.filter((m) => m.id === mailboxIdFilter)
      : mailboxes.filter((m) => Boolean(m.imap.host?.trim()) && m.enabled !== false);

    const byMailbox: Record<
      string,
      { messages: MailInbound[]; syncedAt: string | null; mailboxTotal: number }
    > = {};

    await mapPool(targets, HEADS_READ_CONCURRENCY, async (mb) => {
      const heads = await readInboxHeadsServer({
        organizationId: g.ctx.session.organizationId,
        uid: resolved.dataOwnerUid,
        mailboxId: mb.id,
      });
      const messages =
        messageLimit && heads.messages.length > messageLimit
          ? heads.messages.slice(0, messageLimit)
          : heads.messages;
      byMailbox[mb.id] = { ...heads, messages };
    });

    console.log(
      JSON.stringify({
        level: "info",
        msg: "inbound-heads read",
        mailboxes: targets.length,
        limit: messageLimit,
        ms: Date.now() - started,
      }),
    );

    return NextResponse.json({
      ok: true,
      dataOwnerUid: resolved.dataOwnerUid,
      byMailbox,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "inbound-heads failed",
        error,
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
