"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { mergeFollowupPlans, openFollowupsForPlan } from "@/lib/followup-plans";
import {
  findActivePlanToPauseOnReply,
  inboundMessageLeadId,
  isInboundFromLeadContact,
} from "@/lib/followup-plan-reply";
import {
  cancelScheduledEmailsForFollowups,
  openFollowupsWithScheduledEmail,
} from "@/lib/cancel-followup-scheduled-email-client";
import { buildReplyDetectedPatch, shouldOpenReplyReview } from "@/lib/leads/reply-review";
import { getActiveMailbox, useEmailAccountStore } from "@/stores/email-account-store";
import { toast } from "sonner";

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
 * When new unread inbound mail arrives from a lead:
 * - Cancel pending scheduled emails on that lead's open followups
 * - If an active AI plan exists, pause remaining steps and surface regenerate UX
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
    clearFollowupEmailSchedule,
    patchLeadAsync,
  } = useWorkspace();
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const processedRef = React.useRef(readProcessed());
  const inFlightRef = React.useRef(new Set<string>());

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
      if (processedRef.current.has(mid) || inFlightRef.current.has(mid)) continue;

      const leadId = inboundMessageLeadId({
        mailboxId: acct.id,
        message,
        leads,
        linkedLeadByMessageId,
      });
      if (!leadId) continue;

      const lead = leads.find((l) => l.id === leadId);
      if (!lead || !isInboundFromLeadContact({ message, lead, mailboxEmail })) continue;

      const scheduledOpen = openFollowupsWithScheduledEmail(followups, leadId);
      const plan = findActivePlanToPauseOnReply({ leadId, plans });
      const openIds = plan ? openFollowupsForPlan(followups, plan.id).map((f) => f.id) : [];

      inFlightRef.current.add(mid);
      void (async () => {
        try {
          if (plan && openIds.length > 0) {
            await pauseFollowupPlanForReply({
              planId: plan.id,
              leadId,
              reason: "Lead replied by email",
              replyMessageId: mid,
              actorId: currentUserId,
              openFollowupIds: openIds,
            });
          }

          const { cancelled, errors } = await cancelScheduledEmailsForFollowups({
            followups: scheduledOpen,
            isDemo: false,
            cancelDemo: cancelScheduled,
            clearSchedule: clearFollowupEmailSchedule,
            reason: "Lead replied by email",
          });
          if (errors.length > 0) {
            toast.error("Could not cancel all scheduled followup emails", {
              description: errors[0],
            });
            return;
          }

          const replyAt = new Date().toISOString();
          try {
            await patchLeadAsync(
              leadId,
              buildReplyDetectedPatch({
                lead,
                replyAt,
                replyMessageId: mid,
                source: "imap",
              }),
            );
          } catch {
            /* Reply pause/cancel already applied; review stamp can retry next sync. */
          }

          processedRef.current.add(mid);
          writeProcessed(processedRef.current);

          const openedReview = shouldOpenReplyReview(lead);
          if (openedReview) {
            toast.message("Reply received - review on Dashboard", {
              description:
                lead.companyName || lead.contactName
                  ? `${lead.companyName || lead.contactName}: promote or move to Replied`
                  : "Promote to lead or move to Replied when ready.",
              duration: 9000,
            });
          } else if (!plan && cancelled > 0) {
            toast.message("Lead replied, scheduled followup emails cancelled", {
              description: "Outbound steps will not send. Review the reply in Inbox.",
              duration: 8000,
            });
          }
        } catch {
          /* Leave unprocessed so the next inbox sync retries the reply. */
        } finally {
          inFlightRef.current.delete(mid);
        }
      })();
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
    clearFollowupEmailSchedule,
    cancelScheduled,
    patchLeadAsync,
  ]);

  return null;
}
