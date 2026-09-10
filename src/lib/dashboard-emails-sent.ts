/**
 * Shared “Emails sent” counting for dashboard KPIs / summary / volume chart.
 *
 * Sequence delivery still comes from followups (`deliveryStatus === "sent"`).
 * Compose / inbox / reply SMTP sends are counted via `extraSentAts` (timeline
 * `email_sent` without a followupId, or durable `emailSendEvents`).
 */

import type { Followup, TimelineEvent } from "@/lib/types";

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

/** True when a timeline row is a compose/reply send (not a sequence step). */
export function isComposeEmailSentTimelineEvent(event: TimelineEvent): boolean {
  if (event.type !== "email_sent") return false;
  const followupId = event.payload?.followupId;
  if (typeof followupId === "string" && followupId.trim()) return false;
  return true;
}

/** Timestamps for compose/reply sends already present in the live timeline. */
export function composeEmailSentAtsFromTimeline(
  events: readonly TimelineEvent[],
): number[] {
  const out: number[] = [];
  for (const event of events) {
    if (!isComposeEmailSentTimelineEvent(event)) continue;
    const at = validTime(event.createdAt);
    if (at !== undefined) out.push(at);
  }
  return out;
}

export function flattenTimelineByLead(
  timelineByLead: Record<string, readonly TimelineEvent[] | undefined>,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const events of Object.values(timelineByLead)) {
    if (!events) continue;
    for (const event of events) out.push(event);
  }
  return out;
}

/** Count followup deliveries + optional compose extras in `[rangeStart, ∞)`. */
export function countEmailsSentInRange(input: {
  followups: readonly Followup[];
  extraSentAts?: readonly number[];
  rangeStart: number;
}): number {
  let sent = 0;
  for (const followup of input.followups) {
    const sentAt = validTime(followup.sentAt);
    if (followup.deliveryStatus === "sent" && sentAt !== undefined && sentAt >= input.rangeStart) {
      sent += 1;
    }
  }
  for (const at of input.extraSentAts ?? []) {
    if (Number.isFinite(at) && at >= input.rangeStart) sent += 1;
  }
  return sent;
}
