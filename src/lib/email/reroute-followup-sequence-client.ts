import {
  computeRerouteDueAts,
  isReroutableFollowup,
  scheduleLocalFromDueAt,
} from "@/lib/email/bounce-recovery";
import { isoFromDatetimeLocalInZone, resolveOrgTimezone } from "@/lib/org-timezone";
import { scheduleFollowupEmailClient, followupScheduleMailboxFields } from "@/lib/schedule-followup-email-client";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import type { Followup, FollowupPlan } from "@/lib/types";

export type RerouteSequenceClientInput = {
  leadId: string;
  to: string;
  mailbox: EmailMailboxSettings;
  plan: FollowupPlan;
  followups: readonly Followup[];
  isDemo: boolean;
  /** IANA workspace timezone for due/send wall clocks. */
  timeZone?: string;
  globalEmailFooter?: string;
  includeSignature?: boolean;
  includeFooter?: boolean;
  addDemoScheduled: (row: {
    mailboxId: string;
    from: string;
    displayName?: string;
    replyTo?: string;
    to: string;
    subject: string;
    body: string;
    text: string;
    scheduledAt: string;
    followupId: string;
    leadId: string;
  }) => string;
  /** Cancel an existing pending schedule before re-queue. */
  cancelSchedule: (scheduledEmailId: string) => Promise<boolean>;
  /** Persist dueAt / clear paused on each step before or after schedule. */
  updateFollowupDueAt: (followupId: string, dueAt: string) => void;
  setFollowupEmailSchedule: (
    followupId: string,
    schedule: {
      scheduledEmailId: string;
      emailScheduledAt: string;
      mailboxId?: string;
      fromEmail?: string;
      toEmail?: string;
      mailboxOwnerUid?: string;
    } | null,
  ) => void;
  resumePlan: (input: {
    planId: string;
    leadId: string;
    openFollowupIds: string[];
  }) => Promise<void>;
};

export type RerouteSequenceClientResult =
  | { ok: true; reroutedCount: number; followupIds: string[] }
  | { ok: false; error: string };

/**
 * Client-side resume + reschedule for Flow B (fix email & resume).
 * Reuses existing copy; recomputes dates with the standard cadence.
 */
export async function rerouteFollowupSequenceClient(
  input: RerouteSequenceClientInput,
): Promise<RerouteSequenceClientResult> {
  const to = input.to.trim();
  if (!to.includes("@")) return { ok: false, error: "Enter a valid recipient email" };

  const steps = input.followups
    .filter((f) => f.planId === input.plan.id && isReroutableFollowup(f))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  if (steps.length === 0) {
    await input.resumePlan({
      planId: input.plan.id,
      leadId: input.leadId,
      openFollowupIds: [],
    });
    return { ok: true, reroutedCount: 0, followupIds: [] };
  }

  for (const step of steps) {
    if (!step.scheduledEmailId) continue;
    const ok = await input.cancelSchedule(step.scheduledEmailId);
    if (!ok) return { ok: false, error: "Could not cancel an existing scheduled email" };
    input.setFollowupEmailSchedule(step.id, null);
  }

  const timeZone = resolveOrgTimezone(input.timeZone);
  const dueAts = computeRerouteDueAts(steps.length, new Date(), timeZone);
  await input.resumePlan({
    planId: input.plan.id,
    leadId: input.leadId,
    openFollowupIds: steps.map((s) => s.id),
  });

  let reroutedCount = 0;
  const followupIds: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const dueAt = dueAts[i]!;
    input.updateFollowupDueAt(step.id, dueAt);

    const body = step.messageBody?.trim() ?? "";
    const subject = step.emailSubject?.trim() || step.title;
    if (!body) continue;

    const local = scheduleLocalFromDueAt(dueAt, i, timeZone);
    const scheduledAtIso = isoFromDatetimeLocalInZone(local, timeZone);
    const result = await scheduleFollowupEmailClient({
      followupId: step.id,
      leadId: input.leadId,
      mailbox: input.mailbox,
      to,
      subject,
      body,
      includeSignature: input.includeSignature,
      includeFooter: input.includeFooter,
      globalEmailFooter: input.globalEmailFooter,
      scheduledAtIso,
      isDemo: input.isDemo,
      addDemoScheduled: input.addDemoScheduled,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `Scheduled ${reroutedCount} step(s), then failed: ${result.error}`,
      };
    }
    input.setFollowupEmailSchedule(step.id, {
      scheduledEmailId: result.scheduledEmailId,
      emailScheduledAt: result.emailScheduledAt,
      ...followupScheduleMailboxFields(input.mailbox, to),
    });
    reroutedCount += 1;
    followupIds.push(step.id);
  }

  return { ok: true, reroutedCount, followupIds };
}
