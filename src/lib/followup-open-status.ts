import type { Followup, FollowupDeliveryStatus } from "@/lib/types";
import {
  endOfZonedDay,
  getBrowserTimezone,
  resolveOrgTimezone,
  startOfZonedDay,
} from "@/lib/org-timezone";

const TERMINAL_DELIVERY: ReadonlySet<FollowupDeliveryStatus> = new Set([
  "sent",
  "failed",
  "needs_retry",
  "cancelled",
]);

/** @deprecated Prefer startOfZonedDay with an explicit timezone. */
export function startOfLocalDay(d: Date): Date {
  return startOfZonedDay(d, getBrowserTimezone());
}

/** @deprecated Prefer endOfZonedDay with an explicit timezone. */
export function endOfLocalDay(d: Date): Date {
  return endOfZonedDay(d, getBrowserTimezone());
}

function validDueMs(dueAt: string | undefined): number | undefined {
  if (!dueAt) return undefined;
  const value = new Date(dueAt).getTime();
  return Number.isFinite(value) ? value : undefined;
}

export type FollowupTimeOptions = {
  now?: Date;
  /** IANA timezone; defaults to browser (or UTC on server). */
  timeZone?: string;
};

function effectiveZone(timeZone?: string): string {
  return resolveOrgTimezone(timeZone);
}

/**
 * Open follow-up that still belongs in due / overdue work queues.
 * Excludes completed, paused, and terminal delivery states (sent / failed /
 * retrying / cancelled) so those surface under their own KPIs instead.
 */
export function isFollowupActionable(
  followup: Pick<Followup, "completedAt" | "pausedAt" | "deliveryStatus">,
): boolean {
  if (followup.completedAt || followup.pausedAt) return false;
  const status = followup.deliveryStatus;
  if (status && TERMINAL_DELIVERY.has(status)) return false;
  return true;
}

/**
 * Calendar overdue: due before start of today in `timeZone`.
 * Matches the Follow-ups page bucket (noon due-dates do not flip overdue mid-day).
 */
export function isFollowupOverdue(
  followup: Pick<Followup, "dueAt" | "completedAt" | "pausedAt" | "deliveryStatus">,
  nowOrOpts: Date | FollowupTimeOptions = new Date(),
): boolean {
  if (!isFollowupActionable(followup)) return false;
  const due = validDueMs(followup.dueAt);
  if (due === undefined) return false;
  const opts: FollowupTimeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const now = opts.now ?? new Date();
  return due < startOfZonedDay(now, effectiveZone(opts.timeZone)).getTime();
}

/** Due today or earlier (still actionable). */
export function isFollowupDueThroughToday(
  followup: Pick<Followup, "dueAt" | "completedAt" | "pausedAt" | "deliveryStatus">,
  nowOrOpts: Date | FollowupTimeOptions = new Date(),
): boolean {
  if (!isFollowupActionable(followup)) return false;
  const due = validDueMs(followup.dueAt);
  if (due === undefined) return false;
  const opts: FollowupTimeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const now = opts.now ?? new Date();
  return due <= endOfZonedDay(now, effectiveZone(opts.timeZone)).getTime();
}
