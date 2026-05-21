import type { MailInbound } from "@/lib/email-account-types";
import { appendMailDataOwnerParam } from "@/lib/email/mail-data-owner-query";
import {
  collectBlockedUidsFromInbound,
  partitionInboxByBlockedDomains,
} from "@/lib/email/blocked-sender-domains";
import {
  getActiveMailbox,
  useEmailAccountStore,
} from "@/stores/email-account-store";

async function moveUidsToServerTrashChunked(input: {
  uids: number[];
  mailboxId: string;
  imap: { host: string; port: number; secure: boolean; user: string; password: string };
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<void> {
  const CHUNK = 60;
  for (let i = 0; i < input.uids.length; i += CHUNK) {
    const part = input.uids.slice(i, i + CHUNK);
    const url = appendMailDataOwnerParam("/api/email/imap-mutate", input.mailViewAsUid, input.currentUserId);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "moveInboxToTrash",
        mailboxId: input.mailboxId,
        uids: part,
        imap: {
          host: input.imap.host,
          port: input.imap.port,
          secure: input.imap.secure,
          user: input.imap.user,
          pass: input.imap.password,
        },
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      throw new Error(data.error ?? "Move to Trash failed");
    }
  }
}

/** Move blocked-domain INBOX UIDs to Trash (server or demo local cache). */
export async function trashBlockedInboxUids(input: {
  uids: number[];
  isDemo: boolean;
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<void> {
  const uids = [...new Set(input.uids)].filter((n) => Number.isFinite(n) && n > 0);
  if (uids.length === 0) return;

  const acct = getActiveMailbox(useEmailAccountStore.getState());
  const { moveInboundUidsToTrashLocal, removeInboundByUids } = useEmailAccountStore.getState();

  if (input.isDemo) {
    moveInboundUidsToTrashLocal(acct.id, uids);
    return;
  }

  await moveUidsToServerTrashChunked({
    uids,
    mailboxId: acct.id,
    imap: acct.imap,
    mailViewAsUid: input.mailViewAsUid,
    currentUserId: input.currentUserId,
  });
  removeInboundByUids(acct.id, uids);
}

/**
 * Remove blocked-domain messages from an INBOX batch and move them to Trash.
 * Returns rows safe to show in the inbox list.
 */
export async function filterInboxBatchAndTrashBlocked(input: {
  messages: MailInbound[];
  blockedDomains: readonly string[];
  isDemo: boolean;
  inboxReadOnly: boolean;
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<MailInbound[]> {
  const { visible, blockedUids } = partitionInboxByBlockedDomains(input.messages, input.blockedDomains);
  if (blockedUids.length > 0 && !input.inboxReadOnly) {
    await trashBlockedInboxUids({
      uids: blockedUids,
      isDemo: input.isDemo,
      mailViewAsUid: input.mailViewAsUid,
      currentUserId: input.currentUserId,
    });
  }
  return visible;
}

/** Trash any blocked-domain messages already in the local INBOX cache. */
export async function trashBlockedUidsInCachedInbox(input: {
  mailboxId: string;
  messages: readonly MailInbound[];
  blockedDomains: readonly string[];
  isDemo: boolean;
  inboxReadOnly: boolean;
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<number> {
  const uids = collectBlockedUidsFromInbound(input.messages, input.blockedDomains);
  if (uids.length === 0 || input.inboxReadOnly) return 0;
  await trashBlockedInboxUids({
    uids,
    isDemo: input.isDemo,
    mailViewAsUid: input.mailViewAsUid,
    currentUserId: input.currentUserId,
  });
  return uids.length;
}
