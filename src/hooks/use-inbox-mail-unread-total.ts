"use client";

import * as React from "react";
import { countUnreadInboxThreads } from "@/lib/email/inbox-unread-count";
import { useEmailAccountStore } from "@/stores/email-account-store";

export function useInboxMailUnreadTotal(): number {
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);

  return React.useMemo(
    () => countUnreadInboxThreads({ inboundByMailbox, mailboxes, activeMailboxId }),
    [inboundByMailbox, mailboxes, activeMailboxId],
  );
}
