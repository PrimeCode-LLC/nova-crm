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

function senderFromFollowupFields(
  step: Followup,
  mailboxById: Map<string, EmailMailboxSettings>,
  mailboxByEmail: Map<string, EmailMailboxSettings>,
): PriorSequenceSender | null {
  const mailboxId = step.mailboxId?.trim();
  const fromEmail = step.fromEmail?.trim();
  if (!mailboxId && !fromEmail) return null;

  const fromMb =
    (mailboxId ? mailboxById.get(mailboxId) : undefined) ??
    (fromEmail ? mailboxByEmail.get(normalizeEmail(fromEmail)) : undefined);

  const resolvedId = fromMb?.id ?? mailboxId;
  const resolvedFrom =
    fromMb?.emailAddress.trim() || fromEmail || "";
  if (!resolvedId || !resolvedFrom) return null;

  return {
    mailboxId: resolvedId,
    fromEmail: resolvedFrom,
    followupId: step.id,
  };
}

function sortBySentOrDue(a: Followup, b: Followup): number {
  const aAt = new Date(String(a.sentAt ?? a.dueAt ?? "")).getTime();
  const bAt = new Date(String(b.sentAt ?? b.dueAt ?? "")).getTime();
  if (aAt !== bAt) return aAt - bAt;
  return a.id.localeCompare(b.id);
}

/**
 * Resolve the mailbox that sent (or was queued for) an earlier step in this plan.
 * Prefers durable followup mailbox fields, then scheduled-email history.
 * Returns null when prior mail was outside CRM mailboxes (e.g. Instantly)
 * or history is unavailable.
 */
export function resolvePriorSequenceSender(input: {
  planFollowups: readonly Followup[];
  scheduledEmails: readonly ScheduledEmail[];
  mailboxes: readonly EmailMailboxSettings[];
}): PriorSequenceSender | null {
  const mailboxById = new Map(input.mailboxes.map((m) => [m.id, m]));
  const mailboxByEmail = new Map(
    input.mailboxes
      .map((m) => [normalizeEmail(m.emailAddress), m] as const)
      .filter(([email]) => Boolean(email)),
  );

  const priorSent = input.planFollowups
    .filter(isPriorSentStep)
    .slice()
    .sort(sortBySentOrDue);

  for (const step of priorSent) {
    const fromFields = senderFromFollowupFields(step, mailboxById, mailboxByEmail);
    if (fromFields) return fromFields;
  }

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

  // Resume after cancel/edit: any step that still remembers the mailbox.
  const withMailbox = input.planFollowups
    .filter((s) => Boolean(s.mailboxId?.trim() || s.fromEmail?.trim()))
    .slice()
    .sort(sortBySentOrDue);
  for (const step of withMailbox) {
    const fromFields = senderFromFollowupFields(step, mailboxById, mailboxByEmail);
    if (fromFields) return fromFields;
  }

  return null;
}

/** Prefer a remembered To from plan steps when still in the recipient options. */
export function resolvePriorSequenceRecipient(input: {
  planFollowups: readonly Followup[];
  recipientEmails: readonly string[];
}): string | null {
  const allowed = new Set(
    input.recipientEmails.map((e) => normalizeEmail(e)).filter(Boolean),
  );
  if (allowed.size === 0) return null;

  const ordered = input.planFollowups.slice().sort(sortBySentOrDue);
  for (const step of ordered) {
    const to = step.toEmail?.trim();
    if (to && allowed.has(normalizeEmail(to))) return to;
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
