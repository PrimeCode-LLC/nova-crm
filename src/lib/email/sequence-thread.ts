import { replySubject } from "@/lib/email/reply-compose";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

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

export type SequenceThreadResolution =
  | { kind: "root" }
  | { kind: "wait_for_prior" }
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

function isAwaitingOutboundSend(step: SequenceThreadStep): boolean {
  if (step.pausedAt) return false;
  if (step.deliveryStatus === "sent") return false;
  if (step.deliveryStatus === "cancelled" || step.deliveryStatus === "failed") return false;
  if (step.deliveryStatus === "needs_retry") return true;
  if (step.completedAt && step.deliveryStatus !== "scheduled") return false;
  return Boolean(
    step.scheduledEmailId ||
      step.deliveryStatus === "scheduled" ||
      (step.emailScheduledAt && !step.sentAt),
  );
}

/**
 * Decide threading for a sequence step from earlier steps in the same plan.
 * Call at send time so later steps can reply to Message-IDs that did not exist at schedule time.
 */
export function resolveSequenceThreadContext(
  current: SequenceThreadStep,
  siblings: readonly SequenceThreadStep[],
): SequenceThreadResolution {
  const scoped = current.freshThread
    ? siblings.filter((step) => step.id === current.id || Boolean(step.freshThread))
    : siblings;
  const earlier = scoped.filter((step) => step.id !== current.id && isEarlierStep(step, current));

  if (earlier.some(isAwaitingOutboundSend)) {
    return { kind: "wait_for_prior" };
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
    return { kind: "root" };
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
