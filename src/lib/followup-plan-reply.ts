import type { FollowupPlan, Lead } from "@/lib/types";
import type { MailInbound } from "@/lib/email-account-types";
import { leadContactEmails } from "@/lib/followup-plans";
import { isDeliveryStatusNotification } from "@/lib/email/detect-hard-bounce";

const OOO_RE = /out of office|automatic reply|auto[- ]?reply/i;

export function extractEmailAddress(header: string): string | null {
  const angle = header.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const bare = header.trim().toLowerCase();
  if (bare.includes("@")) return bare.split(/\s+/).find((p) => p.includes("@")) ?? bare;
  return null;
}

/**
 * True for OOO / vacation / ticketing autoresponders / "left company" notices.
 * Bounce DSNs are intentionally excluded — use detectHardBounce / isDeliveryStatusNotification.
 */
export function isLikelyAutoReply(message: Pick<MailInbound, "subject" | "preview">): boolean {
  const blob = `${message.subject} ${message.preview}`;
  if (OOO_RE.test(blob)) return true;
  if (/case\s*#?\s*\d+|ticket\s*#?\s*\d+|your request has been received|auto[- ]?generated/i.test(blob)) {
    return true;
  }
  if (/no longer (with|at) (the )?company|left the company|no longer employed/i.test(blob)) {
    return true;
  }
  return false;
}

export function inboundMessageLeadId(input: {
  mailboxId: string;
  message: MailInbound;
  leads: Lead[];
  linkedLeadByMessageId: Record<string, string>;
  /** Optional contact emails keyed by contact id (company + personal). */
  emailsByContactId?: Record<string, readonly string[]>;
}): string | null {
  const mid = `${input.mailboxId}:in:${input.message.id}`;
  const manual = input.linkedLeadByMessageId[mid];
  if (manual) return manual;

  const fromAddr = extractEmailAddress(input.message.from);
  if (!fromAddr) return null;

  for (const lead of input.leads) {
    const extras = lead.contactId ? input.emailsByContactId?.[lead.contactId] : undefined;
    const emails = leadContactEmails(lead, ...(extras ?? []));
    if (emails.some((e) => fromAddr === e)) return lead.id;
    if (emails.some((e) => `${input.message.from} ${input.message.to}`.toLowerCase().includes(e))) {
      return lead.id;
    }
  }
  return null;
}

export function isInboundFromLeadContact(input: {
  message: MailInbound;
  lead: Lead;
  mailboxEmail?: string;
  /** Extra emails (e.g. personal) beyond lead.contactEmail. */
  contactEmails?: readonly string[];
}): boolean {
  // Bounce DSNs and OOO must not pause sequences as a human reply.
  if (isDeliveryStatusNotification(input.message) || isLikelyAutoReply(input.message)) {
    return false;
  }
  const fromAddr = extractEmailAddress(input.message.from);
  if (!fromAddr) return false;
  const mailbox = input.mailboxEmail?.trim().toLowerCase();
  if (mailbox && fromAddr === mailbox) return false;
  const contacts =
    input.contactEmails && input.contactEmails.length > 0
      ? leadContactEmails(input.lead, ...input.contactEmails)
      : leadContactEmails(input.lead);
  return contacts.some((e) => fromAddr === e);
}

export function findActivePlanToPauseOnReply(input: {
  leadId: string;
  plans: FollowupPlan[];
}): FollowupPlan | undefined {
  return input.plans
    .filter((p) => p.leadId === input.leadId && p.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export type NewInboundForPlanPause = {
  mailboxId: string;
  message: MailInbound;
  mailboxEmail?: string;
};
