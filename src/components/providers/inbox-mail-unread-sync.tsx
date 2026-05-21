"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { syncImapInboxHead } from "@/lib/email/sync-imap-inbox-head";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

/**
 * Keeps INBOX list in the email store fresh so the main sidebar Inbox badge stays accurate
 * even when the user is not on /inbox.
 */
export function InboxMailUnreadSync() {
  const { isDemo, sessionHydrated, currentUserId } = useWorkspace();
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);

  React.useEffect(() => {
    if (isDemo || !sessionHydrated || !currentUserId || !emailServerHydrated) return;
    const acct = getActiveMailbox({ mailboxes, activeMailboxId });
    if (!isImapInboxConfigured(acct)) return;

    void syncImapInboxHead({ mailViewAsUid, currentUserId }).catch(() => {
      /* sidebar badge is best-effort */
    });
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    emailServerHydrated,
    activeMailboxId,
    mailViewAsUid,
    mailboxes,
  ]);

  return null;
}
