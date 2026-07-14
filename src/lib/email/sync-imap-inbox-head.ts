import type { MailInbound } from "@/lib/email-account-types";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import { INBOX_IMAP_HEAD_LIMIT } from "@/lib/email/inbox-unread-count";
import { filterInboxBatchAndTrashBlocked } from "@/lib/email/trash-blocked-inbox-uids";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

/**
 * Fetches the newest INBOX page into the email store (for sidebar unread badge + inbox UI).
 * Silent on failure — callers may surface errors in the inbox UI.
 */
export async function syncImapInboxHead(opts: {
  mailViewAsUid: string | null;
  currentUserId: string;
  isDemo?: boolean;
  inboxReadOnly?: boolean;
}): Promise<void> {
  const st = useEmailAccountStore.getState();
  const acct = getActiveMailbox(st);
  if (!isImapInboxConfigured(acct)) {
    st.setInbound(acct.id, []);
    return;
  }

  const reconcileInboundHeadFromSync = st.reconcileInboundHeadFromSync;
  const blockedDomains = st.blockedSenderDomains;
  const inboxReadOnly = Boolean(opts.inboxReadOnly);
  const isDemo = Boolean(opts.isDemo);
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
      folder: "inbox",
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
  const visible = await filterInboxBatchAndTrashBlocked({
    messages: data.messages,
    blockedDomains,
    isDemo,
    inboxReadOnly,
    mailViewAsUid: opts.mailViewAsUid,
    currentUserId: opts.currentUserId,
  });
  reconcileInboundHeadFromSync(acct.id, visible);
}
