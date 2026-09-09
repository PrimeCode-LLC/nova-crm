import { replySubject } from "@/lib/email/reply-compose";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

/** Default: prior steps older than this are no longer treated as "awaiting send". */
export const SEQUENCE_WAIT_FOR_PRIOR_MAX_MS = 30 * 60 * 1000;

/** Minimal follow-up fields needed to chain sequence emails into one thread. */
export type SequenceThreadStep = {
  id: string;
  dueAt?: string;
  sentAt?: string;
  emailSubject?: string;
  title?: string;
  sentMessageId?: string;
  deliveryStatus?: string;
  scheduledEmailId?: string;
  emailScheduledAt?: string;
  pausedAt?: string;
  completedAt?: string;
  /**
   * When true, only other freshThread siblings participate in threading —
   * prior sent steps without this flag are ignored (start-fresh schedule).
   */
  freshThread?: boolean;
};

/**
 * Conversation a plan continues (the lead's reply, for a regenerated sequence).
 * Used only until the plan sends its own first step, after which that step
 * becomes the thread root.
 */
export type SequenceThreadAnchor = {
  inReplyTo: string;
  referenceIds?: string[];
  subject?: string;
};

export type SequenceThreadBlockedBy = {
  followupId: string;
  deliveryStatus?: string;
};

export type SequenceThreadResolution =
  | { kind: "root" }
  | {
      kind: "wait_for_prior";
      blockedBy: SequenceThreadBlockedBy;
    }
  | {
      kind: "reply";
      inReplyTo: string;
      referenceIds: string[];
      /** Subject rewritten to Re: of the first sent step so clients keep one thread. */
      subject: string;
    };

function dueTime(step: SequenceThreadStep): number {
  const t = new Date(String(step.dueAt ?? "")).getTime();
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function isEarlierStep(a: SequenceThreadStep, current: SequenceThreadStep): boolean {
  const aDue = dueTime(a);
  const cDue = dueTime(current);
  if (aDue !== cDue) return aDue < cDue;
  return a.id < current.id;
}

/** Schedule clock used to decide whether a prior step is stale. */
function awaitingScheduleMs(step: SequenceThreadStep): number | null {
  for (const raw of [step.emailScheduledAt, step.dueAt]) {
    if (!raw) continue;
    const ms = new Date(String(raw)).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * True when an earlier step still appears to owe an outbound send.
 * Stale schedules (older than maxWaitMs) are ignored so dead priors cannot block forever.
 */
export function isAwaitingOutboundSend(
  step: SequenceThreadStep,
  opts?: { nowMs?: number; maxWaitMs?: number },
): boolean {
  if (step.pausedAt) return false;
  if (step.deliveryStatus === "sent") return false;
  if (step.deliveryStatus === "cancelled" || step.deliveryStatus === "failed") return false;
  if (step.completedAt && step.deliveryStatus !== "scheduled" && step.deliveryStatus !== "needs_retry") {
    return false;
  }

  const looksAwaiting =
    step.deliveryStatus === "needs_retry" ||
    Boolean(
      step.scheduledEmailId ||
        step.deliveryStatus === "scheduled" ||
        (step.emailScheduledAt && !step.sentAt),
    );
  if (!looksAwaiting) return false;

  const nowMs = opts?.nowMs ?? Date.now();
  const maxWaitMs = opts?.maxWaitMs ?? SEQUENCE_WAIT_FOR_PRIOR_MAX_MS;
  const scheduleMs = awaitingScheduleMs(step);
  // Unparseable schedule: do not block forever — treat as not awaiting.
  if (scheduleMs == null) return false;
  if (nowMs - scheduleMs >= maxWaitMs) return false;
  return true;
}

/**
 * Decide threading for a sequence step from earlier steps in the same plan.
 * Call at send time so later steps can reply to Message-IDs that did not exist at schedule time.
 */
export function resolveSequenceThreadContext(
  current: SequenceThreadStep,
  siblings: readonly SequenceThreadStep[],
  anchor?: SequenceThreadAnchor,
  opts?: { nowMs?: number; maxWaitMs?: number },
): SequenceThreadResolution {
  const scoped = current.freshThread
    ? siblings.filter((step) => step.id === current.id || Boolean(step.freshThread))
    : siblings;
  const earlier = scoped.filter((step) => step.id !== current.id && isEarlierStep(step, current));

  const blocking = earlier.find((step) => isAwaitingOutboundSend(step, opts));
  if (blocking) {
    return {
      kind: "wait_for_prior",
      blockedBy: {
        followupId: blocking.id,
        deliveryStatus: blocking.deliveryStatus,
      },
    };
  }

  const priorSent = earlier
    .filter((step) => step.deliveryStatus === "sent")
    .map((step) => ({
      step,
      messageId: normalizeMessageId(step.sentMessageId),
      sentAt: new Date(String(step.sentAt ?? step.dueAt ?? "")).getTime(),
    }))
    .filter((row): row is { step: SequenceThreadStep; messageId: string; sentAt: number } =>
      Boolean(row.messageId),
    )
    .sort((a, b) => {
      if (a.sentAt !== b.sentAt) return a.sentAt - b.sentAt;
      return a.step.id.localeCompare(b.step.id);
    });

  if (priorSent.length === 0) {
    const anchorId = current.freshThread ? undefined : normalizeMessageId(anchor?.inReplyTo);
    if (!anchorId) return { kind: "root" };
    const referenceIds = [...new Set(
      [...(anchor?.referenceIds ?? []), anchorId]
        .map((id) => normalizeMessageId(id))
        .filter((id): id is string => Boolean(id)),
    )].slice(-50);
    return {
      kind: "reply",
      inReplyTo: anchorId,
      referenceIds,
      subject: replySubject(anchor?.subject?.trim() || undefined),
    };
  }

  const referenceIds = [
    ...new Set(priorSent.map((row) => row.messageId)),
  ].slice(-50);
  const inReplyTo = referenceIds[referenceIds.length - 1]!;
  const root = priorSent[0]!.step;
  const rootSubject = String(root.emailSubject ?? root.title ?? "").trim();

  return {
    kind: "reply",
    inReplyTo,
    referenceIds,
    subject: replySubject(rootSubject || undefined),
  };
}
