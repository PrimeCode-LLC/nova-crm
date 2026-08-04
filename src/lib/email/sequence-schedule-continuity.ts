import type { EmailMailboxSettings, ScheduledEmail } from "@/lib/email-account-types";
import type { Followup } from "@/lib/types";

/** How remaining sequence steps should relate to prior outbound mail. */
export type SequenceScheduleContinuityMode = "continue" | "start_fresh";

export type PriorSequenceSender = {
  mailboxId: string;
  fromEmail: string;
  /** Follow-up id of the earliest prior sent step used for affinity. */
  followupId: string;
};

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isPriorSentStep(step: Followup): boolean {
  if (step.deliveryStatus === "sent") return true;
  return Boolean(step.sentAt || step.sentMessageId);
}

/** True when the active plan already has at least one successfully sent email step. */
export function planHasPriorSentEmailSteps(
  planFollowups: readonly Followup[],
): boolean {
  return planFollowups.some(isPriorSentStep);
}

/**
 * Resolve the mailbox that sent an earlier step in this plan, when known.
 * Uses scheduled-email history (by followup id / scheduledEmailId) and mailbox
 * address matching. Returns null when prior mail was outside CRM mailboxes
 * (e.g. Instantly) or history is unavailable.
 */
export function resolvePriorSequenceSender(input: {
  planFollowups: readonly Followup[];
  scheduledEmails: readonly ScheduledEmail[];
  mailboxes: readonly EmailMailboxSettings[];
}): PriorSequenceSender | null {
  const priorSent = input.planFollowups
    .filter(isPriorSentStep)
    .slice()
    .sort((a, b) => {
      const aAt = new Date(String(a.sentAt ?? a.dueAt ?? "")).getTime();
      const bAt = new Date(String(b.sentAt ?? b.dueAt ?? "")).getTime();
      if (aAt !== bAt) return aAt - bAt;
      return a.id.localeCompare(b.id);
    });

  if (priorSent.length === 0) return null;

  const mailboxById = new Map(input.mailboxes.map((m) => [m.id, m]));
  const mailboxByEmail = new Map(
    input.mailboxes
      .map((m) => [normalizeEmail(m.emailAddress), m] as const)
      .filter(([email]) => Boolean(email)),
  );

  for (const step of priorSent) {
    const byScheduleId = step.scheduledEmailId
      ? input.scheduledEmails.find((s) => s.id === step.scheduledEmailId)
      : undefined;
    const byFollowup = input.scheduledEmails
      .filter((s) => s.followupId === step.id && (s.status === "sent" || s.status === "pending"))
      .sort((a, b) => {
        const aAt = new Date(String(a.sentAt ?? a.scheduledAt ?? "")).getTime();
        const bAt = new Date(String(b.sentAt ?? b.scheduledAt ?? "")).getTime();
        return bAt - aAt;
      })[0];
    const scheduled = byScheduleId ?? byFollowup;
    if (!scheduled) continue;

    const fromMb =
      mailboxById.get(scheduled.mailboxId) ??
      mailboxByEmail.get(normalizeEmail(scheduled.from));
    if (!fromMb) continue;

    return {
      mailboxId: fromMb.id,
      fromEmail: fromMb.emailAddress.trim() || scheduled.from.trim(),
      followupId: step.id,
    };
  }

  return null;
}

export type ContinuityPreflightCounts = {
  /** Ready leads with no prior sent steps in the active plan. */
  firstTouch: number;
  /** Ready leads that already have at least one sent step. */
  continuing: number;
  /** Continuing leads where we know the prior CRM mailbox. */
  priorSenderKnown: number;
  /** Continuing leads with unknown prior sender (e.g. Instantly). */
  priorSenderUnknown: number;
};

export function countContinuityPreflight(input: {
  readyLeadIds: readonly string[];
  planFollowupsByLeadId: ReadonlyMap<string, readonly Followup[]>;
  scheduledEmails: readonly ScheduledEmail[];
  mailboxes: readonly EmailMailboxSettings[];
}): ContinuityPreflightCounts {
  let firstTouch = 0;
  let continuing = 0;
  let priorSenderKnown = 0;
  let priorSenderUnknown = 0;

  for (const leadId of input.readyLeadIds) {
    const steps = input.planFollowupsByLeadId.get(leadId) ?? [];
    if (!planHasPriorSentEmailSteps(steps)) {
      firstTouch += 1;
      continue;
    }
    continuing += 1;
    const prior = resolvePriorSequenceSender({
      planFollowups: steps,
      scheduledEmails: input.scheduledEmails,
      mailboxes: input.mailboxes,
    });
    if (prior) priorSenderKnown += 1;
    else priorSenderUnknown += 1;
  }

  return { firstTouch, continuing, priorSenderKnown, priorSenderUnknown };
}
