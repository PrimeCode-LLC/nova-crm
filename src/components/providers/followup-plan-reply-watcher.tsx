"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildLeadEmailToIdMap, mergeFollowupPlans, openFollowupsForPlan } from "@/lib/followup-plans";
import {
  extractEmailAddress,
  findActivePlanToPauseOnReply,
  isLikelyAutoReply,
} from "@/lib/followup-plan-reply";
import { parseOooReturnDate } from "@/lib/email/ooo-return-date";
import { isDeliveryStatusNotification } from "@/lib/email/detect-hard-bounce";
import {
  cancelScheduledEmailsForFollowups,
  openFollowupsWithScheduledEmail,
} from "@/lib/cancel-followup-scheduled-email-client";
import { dispatchLeadReplyReceived } from "@/lib/email/lead-reply-events";
import { buildReplyDetectedPatch, shouldOpenReplyReview } from "@/lib/leads/reply-review";
import { isImapInboxConfigured, useEmailAccountStore } from "@/stores/email-account-store";
import { toast } from "sonner";

const PROCESSED_KEY = "nova-followup-reply-processed";
/** Only backfill recently-seen mail so sync-after-read still stamps lastReplyAt. */
const MAX_REPLY_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Cap in-flight Firestore patches so inbox stays responsive. */
const MAX_CONCURRENT = 2;
/** Seen (already-read) messages processed per effect tick — unread are uncapped within concurrency. */
const MAX_SEEN_BACKFILL_PER_RUN = 3;

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
 * When new inbound mail arrives from a lead:
 * - Human replies: cancel scheduled emails, pause plans, set lastReplyAt / reply review
 * - OOO / auto-replies: stamp lastAutoReplyAt only (no sequence pause, no dashboard reply)
 *
 * Performance: unread-first, concurrency-limited, skip already-stamped leads, O(1) email→lead map.
 */
export function FollowupPlanReplyWatcher() {
  const {
    isDemo,
    sessionHydrated,
    currentUserId,
    leads,
    contacts,
    followups,
    followupPlans,
    pauseFollowupPlanForReply,
    clearFollowupEmailSchedule,
    patchLeadAsync,
  } = useWorkspace();
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const processedRef = React.useRef(readProcessed());
  const inFlightRef = React.useRef(new Set<string>());

  const emailToLeadId = React.useMemo(
    () => buildLeadEmailToIdMap(leads, contacts),
    [leads, contacts],
  );
  const leadById = React.useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  const plans = React.useMemo(
    () => mergeFollowupPlans(followupPlans, followups),
    [followupPlans, followups],
  );

  React.useEffect(() => {
    if (!sessionHydrated || !currentUserId || isDemo) return;

    // Scan every mailbox with heads — "All mailboxes" must not miss replies on non-primary boxes.
    const mailboxesToScan =
      mailboxes.length > 0
        ? mailboxes.filter((mb) => isImapInboxConfigured(mb) || (inboundByMailbox[mb.id]?.length ?? 0) > 0)
        : [];
    const now = Date.now();

    type Candidate = {
      mid: string;
      mailboxId: string;
      message: (typeof inboundByMailbox)[string][number];
      leadId: string;
      seen: boolean;
      auto: boolean;
    };
    const candidates: Candidate[] = [];

    for (const acct of mailboxesToScan) {
      const mailboxEmail = acct.emailAddress?.trim().toLowerCase();
      const messages = inboundByMailbox[acct.id] ?? [];

      for (const message of messages) {
        const mid = `${acct.id}:in:${message.id}`;
        if (processedRef.current.has(mid) || inFlightRef.current.has(mid)) continue;

        const ageMs = now - Date.parse(message.date);
        if (!Number.isFinite(ageMs) || ageMs > MAX_REPLY_AGE_MS) continue;
        if (isDeliveryStatusNotification(message)) continue;

        const manual = linkedLeadByMessageId[mid];
        const fromAddr = extractEmailAddress(message.from);
        const leadId =
          manual ||
          (fromAddr ? emailToLeadId.get(fromAddr) : undefined) ||
          null;
        if (!leadId) continue;

        const lead = leadById.get(leadId);
        if (!lead) continue;

        const auto = isLikelyAutoReply(message);
        if (auto) {
          if (
            lead.lastAutoReplyMessageId === mid ||
            (lead.lastAutoReplyAt &&
              Number.isFinite(Date.parse(lead.lastAutoReplyAt)) &&
              Date.parse(lead.lastAutoReplyAt) >= Date.parse(message.date))
          ) {
            processedRef.current.add(mid);
            continue;
          }
          candidates.push({
            mid,
            mailboxId: acct.id,
            message,
            leadId,
            seen: Boolean(message.seen),
            auto: true,
          });
          continue;
        }

        if (lead.lastReplyMessageId === mid) {
          processedRef.current.add(mid);
          continue;
        }

        // Already matched From → lead via email index (company + personal).
        // Only block mail that is from our own mailbox (sent copies in INBOX).
        if (mailboxEmail && fromAddr === mailboxEmail) continue;

        // Prefer unread; still allow a small seen backfill for sync-after-read.
        candidates.push({
          mid,
          mailboxId: acct.id,
          message,
          leadId,
          seen: Boolean(message.seen),
          auto: false,
        });
      }
    }

    // Unread first, then newest.
    candidates.sort((a, b) => {
      if (a.seen !== b.seen) return Number(a.seen) - Number(b.seen);
      return b.message.date.localeCompare(a.message.date);
    });

    let seenStarted = 0;
    for (const c of candidates) {
      if (inFlightRef.current.size >= MAX_CONCURRENT) break;
      if (c.seen) {
        if (seenStarted >= MAX_SEEN_BACKFILL_PER_RUN) continue;
        seenStarted += 1;
      }

      const lead = leadById.get(c.leadId);
      if (!lead) continue;

      inFlightRef.current.add(c.mid);

      if (c.auto) {
        void (async () => {
          try {
            const waitUntil = parseOooReturnDate(
              `${c.message.subject}\n${c.message.preview || ""}\n${c.message.bodyText || ""}`,
            );
            await patchLeadAsync(c.leadId, {
              lastAutoReplyAt: c.message.date || new Date().toISOString(),
              lastAutoReplyMessageId: c.mid,
              lastActivityAt: c.message.date || new Date().toISOString(),
              ...(waitUntil ? { followUpAfterDate: waitUntil } : {}),
            });
            processedRef.current.add(c.mid);
            writeProcessed(processedRef.current);
          } catch {
            /* retry next sync */
          } finally {
            inFlightRef.current.delete(c.mid);
          }
        })();
        continue;
      }

      const scheduledOpen = openFollowupsWithScheduledEmail(followups, c.leadId);
      const plan = findActivePlanToPauseOnReply({ leadId: c.leadId, plans });
      const openIds = plan ? openFollowupsForPlan(followups, plan.id).map((f) => f.id) : [];

      void (async () => {
        try {
          if (plan && openIds.length > 0) {
            await pauseFollowupPlanForReply({
              planId: plan.id,
              leadId: c.leadId,
              reason: "Lead replied by email",
              replyMessageId: c.mid,
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
            selfUid: currentUserId,
            activeMailboxDataOwnerUid: mailboxes.find((mb) => mb.id === c.mailboxId)?.dataOwnerUid,
          });
          if (errors.length > 0) {
            toast.error("Could not cancel all scheduled followup emails", {
              description: errors[0],
            });
            return;
          }

          const replyAt = new Date().toISOString();
          let stamped = false;
          try {
            await patchLeadAsync(
              c.leadId,
              buildReplyDetectedPatch({
                lead,
                replyAt,
                replyMessageId: c.mid,
                source: "imap",
              }),
            );
            stamped = true;
          } catch {
            /* Reply pause/cancel already applied; review stamp can retry next sync. */
          }

          processedRef.current.add(c.mid);
          writeProcessed(processedRef.current);

          if (stamped) {
            dispatchLeadReplyReceived({
              leadId: c.leadId,
              replyMessageId: c.mid,
              source: "imap",
            });
          }

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
          inFlightRef.current.delete(c.mid);
        }
      })();
    }

    // Persist skip marks for already-stamped messages without waiting for writes.
    if (processedRef.current.size > 0) writeProcessed(processedRef.current);
  }, [
    sessionHydrated,
    currentUserId,
    isDemo,
    leads,
    followups,
    plans,
    inboundByMailbox,
    linkedLeadByMessageId,
    emailToLeadId,
    leadById,
    mailboxes,
    pauseFollowupPlanForReply,
    clearFollowupEmailSchedule,
    cancelScheduled,
    patchLeadAsync,
  ]);

  return null;
}
