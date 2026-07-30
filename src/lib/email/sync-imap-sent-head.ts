import type { MailInbound } from "@/lib/email-account-types";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import { BACKGROUND_IMAP_HEAD_LIMIT } from "@/lib/email/inbox-unread-count";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

/**
 * Fetches the newest Sent-folder page into the email store (Gmail web/mobile, other clients, Nova).
 * Silent on failure - the Sent tab surfaces errors when opened.
 * Uses a small head limit so background sync does not monopolize the local Next.js process.
 */
export async function syncImapSentHead(opts: {
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<void> {
  const st = useEmailAccountStore.getState();
  const acct = getActiveMailbox(st);
  if (!isImapInboxConfigured(acct)) return;

  const reconcileSentHeadFromSync = st.reconcileSentHeadFromSync;
  const forUid = resolveMailApiForUserUid({
    mailViewAsUid: opts.mailViewAsUid,
    activeMailboxDataOwnerUid: acct.dataOwnerUid,
    selfUid: opts.currentUserId,
  });
  const url = appendMailDataOwnerParam("/api/email/imap-fetch", forUid, opts.currentUserId);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mailboxId: acct.id,
      folder: "sent",
      limit: BACKGROUND_IMAP_HEAD_LIMIT,
      offset: 0,
      // Background Sent sync only needs envelopes - full bodies load on thread open.
      headsOnly: true,
      imap: {
        host: acct.imap.host,
        port: acct.imap.port,
        secure: acct.imap.secure,
        user: acct.imap.user.trim() || acct.emailAddress.trim(),
        pass: acct.imap.password,
      },
    }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    messages?: MailInbound[];
  };
  if (!data.ok || !Array.isArray(data.messages)) return;
  reconcileSentHeadFromSync(acct.id, data.messages);
}
