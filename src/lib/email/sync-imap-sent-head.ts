import type { MailInbound } from "@/lib/email-account-types";
import { appendMailDataOwnerParam } from "@/lib/email/mail-data-owner-query";
import { INBOX_IMAP_HEAD_LIMIT } from "@/lib/email/inbox-unread-count";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

/**
 * Fetches the newest Sent-folder page into the email store (Gmail web/mobile, other clients, Nova).
 * Silent on failure — the Sent tab surfaces errors when opened.
 */
export async function syncImapSentHead(opts: {
  mailViewAsUid: string | null;
  currentUserId: string;
}): Promise<void> {
  const st = useEmailAccountStore.getState();
  const acct = getActiveMailbox(st);
  if (!isImapInboxConfigured(acct)) return;

  const reconcileSentHeadFromSync = st.reconcileSentHeadFromSync;
  const url = appendMailDataOwnerParam("/api/email/imap-fetch", opts.mailViewAsUid, opts.currentUserId);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mailboxId: acct.id,
      folder: "sent",
      limit: INBOX_IMAP_HEAD_LIMIT,
      offset: 0,
      imap: {
        host: acct.imap.host,
        port: acct.imap.port,
        secure: acct.imap.secure,
        user: acct.imap.user,
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
