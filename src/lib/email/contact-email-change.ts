import { BOUNCE_REVIEW_TASK_TITLE, LINKEDIN_SEQUENCE_TASK_TITLE } from "@/lib/email/detect-hard-bounce";
import { leadSnapshotPatchFromAccountContact } from "@/lib/lead-graph-snapshots";
import type { Contact, Lead, LeadTask, TimelineEvent } from "@/lib/types";

export type ContactEmailField = "email" | "personalEmail";

export type ContactEmailChange = {
  field: ContactEmailField;
  label: "Company email" | "Personal email";
  from: string;
  to: string;
};

function norm(email: string | undefined | null): string {
  return (email ?? "").trim().toLowerCase();
}

function display(email: string | undefined | null): string {
  const t = (email ?? "").trim();
  return t || "(empty)";
}

export function isBounceReviewTask(task: LeadTask): boolean {
  if (task.source === "email_bounce") return true;
  return (
    task.taskType === "review" &&
    (task.title === BOUNCE_REVIEW_TASK_TITLE || task.title === LINKEDIN_SEQUENCE_TASK_TITLE)
  );
}

export function contactHasBouncedEmail(contact: Contact | undefined | null): boolean {
  return contact?.emailVerificationStatus === "bounced";
}

/** Diff company / personal email between current contact and an incoming patch. */
export function diffContactEmailChanges(
  contact: Contact,
  contactPatch: Partial<Contact>,
): ContactEmailChange[] {
  const changes: ContactEmailChange[] = [];
  if (contactPatch.email !== undefined && norm(contactPatch.email) !== norm(contact.email)) {
    changes.push({
      field: "email",
      label: "Company email",
      from: display(contact.email),
      to: display(contactPatch.email),
    });
  }
  if (
    contactPatch.personalEmail !== undefined &&
    norm(contactPatch.personalEmail) !== norm(contact.personalEmail)
  ) {
    changes.push({
      field: "personalEmail",
      label: "Personal email",
      from: display(contact.personalEmail),
      to: display(contactPatch.personalEmail),
    });
  }
  return changes;
}

export function emailChangeTimelineSummary(change: ContactEmailChange): string {
  return `${change.label} changed from ${change.from} → ${change.to}`;
}

export function buildEmailChangeTimelineEvents(input: {
  leadId: string;
  actorId: string;
  changes: readonly ContactEmailChange[];
  now?: string;
  newId?: () => string;
}): TimelineEvent[] {
  if (input.changes.length === 0) return [];
  const now = input.now ?? new Date().toISOString();
  const newId =
    input.newId ??
    (() =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `te-${crypto.randomUUID()}`
        : `te-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  return input.changes.map((change) => ({
    id: newId(),
    leadId: input.leadId,
    type: "field_changed" as const,
    actorId: input.actorId,
    summary: emailChangeTimelineSummary(change),
    payload: {
      field: change.field,
      from: change.from === "(empty)" ? "" : change.from,
      to: change.to === "(empty)" ? "" : change.to,
    },
    createdAt: now,
  }));
}

/**
 * When replacing a bounced company email (or clearing bounce after any email fix),
 * reset verification + bounce timestamp and sync lead snapshot emailVerified.
 */
export function contactPatchClearingBounce(
  contact: Contact,
  contactPatch: Partial<Contact>,
): Partial<Contact> {
  if (contact.emailVerificationStatus !== "bounced") return contactPatch;

  const nextEmail = contactPatch.email !== undefined ? contactPatch.email : contact.email;
  const emailChanged =
    contactPatch.email !== undefined && norm(contactPatch.email) !== norm(contact.email);

  // Only auto-clear bounce when the company email actually changes (or status is set explicitly).
  if (!emailChanged && contactPatch.emailVerificationStatus === undefined) {
    return contactPatch;
  }

  const next: Partial<Contact> = { ...contactPatch };
  if (emailChanged || contactPatch.emailVerificationStatus === "not_verified" || contactPatch.emailVerificationStatus === "verified") {
    if (next.emailVerificationStatus === undefined || next.emailVerificationStatus === "bounced") {
      next.emailVerificationStatus = "not_verified";
    }
    next.emailVerified = next.emailVerificationStatus === "verified";
    next.emailBouncedAt = undefined;
  }

  // Keep lead emailVerified in sync via snapshot when email string changes.
  void nextEmail;
  return next;
}

export function applyContactEmailUpdate(input: {
  contact: Contact;
  lead: Lead;
  field: ContactEmailField;
  nextEmail: string;
}): {
  contactPatch: Partial<Contact>;
  leadPatch: Partial<Lead>;
  changes: ContactEmailChange[];
} {
  const trimmed = input.nextEmail.trim();
  const rawPatch: Partial<Contact> =
    input.field === "email" ? { email: trimmed || undefined } : { personalEmail: trimmed || undefined };

  const contactPatch = contactPatchClearingBounce(input.contact, rawPatch);
  const changes = diffContactEmailChanges(input.contact, contactPatch);
  const leadPatch: Partial<Lead> = {
    ...leadSnapshotPatchFromAccountContact({}, contactPatch),
  };
  if (contactPatch.emailVerified !== undefined) {
    leadPatch.emailVerified = contactPatch.emailVerified;
  }
  return { contactPatch, leadPatch, changes };
}

export function openBounceReviewTasksForLead(
  tasks: readonly LeadTask[],
  leadId: string,
): LeadTask[] {
  return tasks.filter(
    (t) => t.leadId === leadId && !t.completedAt && isBounceReviewTask(t),
  );
}
