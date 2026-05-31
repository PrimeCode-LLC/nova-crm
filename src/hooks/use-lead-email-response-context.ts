"use client";

import * as React from "react";
import { useEmailAccountStore } from "@/stores/email-account-store";
import type { LeadEmailResponseContext } from "@/lib/email/lead-response-time";

export function useLeadEmailResponseContext(): LeadEmailResponseContext {
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const sent = useEmailAccountStore((s) => s.sent);

  return React.useMemo(
    () => ({
      mailboxes,
      linkedLeadByMessageId,
      inboundByMailbox,
      sent,
    }),
    [mailboxes, linkedLeadByMessageId, inboundByMailbox, sent],
  );
}
