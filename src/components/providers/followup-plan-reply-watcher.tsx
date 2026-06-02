"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { mergeFollowupPlans, openFollowupsForPlan } from "@/lib/followup-plans";
import {
  findActivePlanToPauseOnReply,
  inboundMessageLeadId,
  isInboundFromLeadContact,
} from "@/lib/followup-plan-reply";
import { getActiveMailbox, useEmailAccountStore } from "@/stores/email-account-store";

const PROCESSED_KEY = "nova-followup-reply-processed";

function readProcessed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(PROCESSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeProcessed(set: Set<string>) {
  if (typeof window === "undefined") return;
  const trimmed = [...set].slice(-500);
  try {
    window.sessionStorage.setItem(PROCESSED_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

/**
 * When new unread inbound mail arrives from a lead with an active follow-up plan,
 * pause remaining steps and surface regenerate UX on the lead.
 */
export function FollowupPlanReplyWatcher() {
  const {
    isDemo,
    sessionHydrated,
    currentUserId,
    leads,
    followups,
    followupPlans,
    pauseFollowupPlanForReply,
  } = useWorkspace();
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const processedRef = React.useRef(readProcessed());

  const plans = React.useMemo(
    () => mergeFollowupPlans(followupPlans, followups),
    [followupPlans, followups],
  );

  React.useEffect(() => {
    if (!sessionHydrated || !currentUserId || isDemo) return;

    const acct = getActiveMailbox({ mailboxes, activeMailboxId });
    const mailboxEmail = acct.emailAddress?.trim().toLowerCase();
    const messages = inboundByMailbox[acct.id] ?? [];

    for (const message of messages) {
      if (message.seen) continue;
      const mid = `${acct.id}:in:${message.id}`;
      if (processedRef.current.has(mid)) continue;

      const leadId = inboundMessageLeadId({
        mailboxId: acct.id,
        message,
        leads,
        linkedLeadByMessageId,
      });
      if (!leadId) continue;

      const lead = leads.find((l) => l.id === leadId);
      if (!lead || !isInboundFromLeadContact({ message, lead, mailboxEmail })) continue;

      const plan = findActivePlanToPauseOnReply({ leadId, plans });
      if (!plan) {
        processedRef.current.add(mid);
        continue;
      }

      const openIds = openFollowupsForPlan(followups, plan.id).map((f) => f.id);
      if (openIds.length === 0) {
        processedRef.current.add(mid);
        continue;
      }

      processedRef.current.add(mid);
      writeProcessed(processedRef.current);

      pauseFollowupPlanForReply({
        planId: plan.id,
        leadId,
        reason: "Lead replied by email",
        replyMessageId: mid,
        actorId: currentUserId,
        openFollowupIds: openIds,
      });
    }
  }, [
    sessionHydrated,
    currentUserId,
    isDemo,
    leads,
    followups,
    plans,
    inboundByMailbox,
    linkedLeadByMessageId,
    mailboxes,
    activeMailboxId,
    pauseFollowupPlanForReply,
  ]);

  return null;
}
