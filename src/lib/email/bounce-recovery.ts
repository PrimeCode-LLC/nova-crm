import {
  dateInputForSequenceStep,
  isoFromDateInput,
} from "@/lib/followup-date";
import { datetimeLocalInZone, resolveOrgTimezone } from "@/lib/org-timezone";
import type { Contact, Followup, Lead } from "@/lib/types";

export type BounceRecoveryAction =
  | "failover_personal"
  | "pause_fix_email"
  | "pause_linkedin"
  | "pause_find_email";

function normEmail(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Remaining sequence steps that can be re-queued after a bounce (not yet delivered). */
export function isReroutableFollowup(f: Pick<
  Followup,
  "completedAt" | "sentAt" | "deliveryStatus" | "sentMessageId"
>): boolean {
  if (f.completedAt) return false;
  if (f.sentAt || f.sentMessageId) return false;
  if (f.deliveryStatus === "sent") return false;
  return true;
}

/**
 * Decide bounce recovery path.
 * - 1st hard bounce + personal still clean → auto failover
 * - 2nd+ hard bounce + LinkedIn → suggest LinkedIn
 * - otherwise → pause for email fix
 */
export function resolveBounceRecoveryAction(input: {
  /** Bounce count after incrementing this event. */
  bounceCountAfter: number;
  companyEmail?: string | null;
  personalEmail?: string | null;
  failedRecipients: readonly string[];
  linkedin?: string | null;
}): BounceRecoveryAction {
  const failed = new Set(input.failedRecipients.map(normEmail).filter((e) => e.includes("@")));
  const company = normEmail(input.companyEmail);
  const personal = normEmail(input.personalEmail);
  const hasLinkedIn = Boolean((input.linkedin ?? "").trim());

  if (input.bounceCountAfter >= 2) {
    return hasLinkedIn ? "pause_linkedin" : "pause_find_email";
  }

  const personalAvailable =
    Boolean(personal) &&
    personal.includes("@") &&
    !failed.has(personal) &&
    personal !== company;

  if (personalAvailable) return "failover_personal";
  return "pause_fix_email";
}

export function resolveFailoverToEmail(contact: Pick<Contact, "email" | "personalEmail">): string | null {
  const personal = (contact.personalEmail ?? "").trim();
  if (!personal || !personal.includes("@")) return null;
  const company = normEmail(contact.email);
  if (normEmail(personal) === company) return null;
  return personal;
}

/**
 * Recompute dueAt ISO timestamps for remaining steps using the standard cadence
 * (Day 0 → +3 BD → +5 BD → +7 BD…), starting from `from` (default: today).
 * Pass org `timeZone` so noon-of-day dueAts align with the workspace.
 */
export function computeRerouteDueAts(
  stepCount: number,
  from: Date = new Date(),
  timeZone?: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < stepCount; i++) {
    out.push(
      isoFromDateInput(
        dateInputForSequenceStep(i, { includeInitial: true, from, timeZone }),
        timeZone,
      ),
    );
  }
  return out;
}

/**
 * Datetime-local wall clock in `timeZone` for queueing, at least 1 minute ahead.
 * Convert with `isoFromDatetimeLocalInZone` before storing.
 */
export function scheduleLocalFromDueAt(
  dueAtIso: string,
  stepIndex: number,
  timeZone?: string,
): string {
  const zone = resolveOrgTimezone(timeZone);
  const min = new Date(Date.now() + 60_000 + stepIndex * 60_000);
  const preferred = new Date(dueAtIso);
  const use =
    !Number.isNaN(preferred.getTime()) && preferred.getTime() >= min.getTime() ? preferred : min;
  return datetimeLocalInZone(use, zone);
}

export function leadHasLinkedIn(lead: Pick<Lead, "contactLinkedIn">, contact?: Pick<Contact, "linkedin"> | null): boolean {
  return Boolean((contact?.linkedin ?? lead.contactLinkedIn ?? "").trim());
}

export function resolveLeadLinkedIn(
  lead: Pick<Lead, "contactLinkedIn">,
  contact?: Pick<Contact, "linkedin"> | null,
): string {
  return (contact?.linkedin ?? lead.contactLinkedIn ?? "").trim();
}
