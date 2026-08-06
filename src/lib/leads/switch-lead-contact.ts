import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import type { Contact, Lead, TimelineEvent } from "@/lib/types";

/** Denormalized lead fields taken from the active outreach contact. */
export function leadContactSnapshotFromContact(contact: Contact): Partial<Lead> {
  const out: Partial<Lead> = {
    contactName: contact.fullName.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim(),
    contactTitle: contact.title,
    contactEmail: contact.email,
    contactLinkedIn: contact.linkedin,
  };

  const source = contact.emailVerificationSource;
  if (source === "millionverifier" || source === "bounce") {
    out.emailVerificationStatus = contact.emailVerificationStatus;
    out.emailVerificationSource = source;
    out.emailVerified = contact.emailVerificationStatus === "verified";
  } else {
    // New person: clear bounce/verification denorm so badges don't inherit the old contact.
    out.emailVerificationStatus = contact.emailVerificationStatus ?? "not_verified";
    out.emailVerificationSource = undefined;
    out.emailVerified = Boolean(contact.emailVerified);
  }

  return out;
}

/** Preferred outreach address on the new contact (company, or personal if company bounced). */
export function resumeEmailForContact(
  lead: Pick<Lead, "contactEmail">,
  contact: Contact,
): string | null {
  const options = buildContactRecipientOptions(lead, contact);
  const email = defaultContactRecipientEmail(options).trim();
  if (!email || !email.includes("@")) return null;
  // Don't resume onto a bounced company address with no personal fallback.
  const chosen = options.find((o) => o.email.toLowerCase() === email.toLowerCase());
  if (chosen?.bounced) return null;
  return email;
}

export function applyLeadContactSwitch(input: {
  lead: Lead;
  fromContact?: Contact | null;
  toContact: Contact;
  /** Optional ICP persona override when the new person is a different role. */
  personaId?: string | null;
}): {
  leadPatch: Partial<Lead>;
  timelineSummary: string;
  resumeToEmail: string | null;
} {
  const { lead, fromContact, toContact } = input;
  if (toContact.id === lead.contactId) {
    throw new Error("That contact is already on this opportunity");
  }
  if (fromContact && toContact.accountId !== fromContact.accountId) {
    throw new Error("New contact must belong to the same company");
  }
  if (toContact.accountId !== lead.accountId) {
    throw new Error("New contact must belong to the same company");
  }

  const fromName =
    fromContact?.fullName?.trim() ||
    lead.contactName?.trim() ||
    "previous contact";
  const toName = toContact.fullName.trim() || "new contact";

  const leadPatch: Partial<Lead> = {
    contactId: toContact.id,
    ...leadContactSnapshotFromContact(toContact),
    // Fresh person → reset bounce exhaustion so recovery can run again if needed.
    emailHardBounceCount: 0,
    suggestLinkedInSequence: false,
  };

  if (input.personaId !== undefined) {
    // `null` / "" clears persona; otherwise set the selected ICP role.
    leadPatch.personaId = input.personaId?.trim() ? input.personaId : undefined;
  }

  return {
    leadPatch,
    timelineSummary: `Outreach contact switched from ${fromName} → ${toName} (same company)`,
    resumeToEmail: resumeEmailForContact(
      { contactEmail: toContact.email ?? lead.contactEmail },
      toContact,
    ),
  };
}

export function buildLeadContactSwitchTimelineEvent(input: {
  leadId: string;
  actorId: string;
  fromContactId: string;
  toContactId: string;
  fromName: string;
  toName: string;
  summary: string;
  now?: string;
  newId?: () => string;
}): TimelineEvent {
  const now = input.now ?? new Date().toISOString();
  const id =
    input.newId?.() ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `te-${crypto.randomUUID()}`
      : `te-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  return {
    id,
    leadId: input.leadId,
    type: "field_changed",
    actorId: input.actorId,
    summary: input.summary,
    payload: {
      field: "contactId",
      from: input.fromContactId,
      to: input.toContactId,
      fromName: input.fromName,
      toName: input.toName,
    },
    createdAt: now,
  };
}

/** Other people on the same account who can replace the current outreach contact. */
export function siblingContactsOnAccount(
  contacts: readonly Contact[],
  accountId: string,
  currentContactId: string,
): Contact[] {
  return contacts
    .filter((c) => c.accountId === accountId && c.id !== currentContactId)
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
