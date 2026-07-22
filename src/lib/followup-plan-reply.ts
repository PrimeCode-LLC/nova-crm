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

/** True for OOO / vacation / generic auto-replies — not bounce DSNs (see detectHardBounce). */
export function isLikelyAutoReply(message: Pick<MailInbound, "subject" | "preview">): boolean {
  return OOO_RE.test(`${message.subject} ${message.preview}`);
}

export function inboundMessageLeadId(input: {
  mailboxId: string;
  message: MailInbound;
  leads: Lead[];
  linkedLeadByMessageId: Record<string, string>;
}): string | null {
  const mid = `${input.mailboxId}:in:${input.message.id}`;
  const manual = input.linkedLeadByMessageId[mid];
  if (manual) return manual;

  const fromAddr = extractEmailAddress(input.message.from);
  if (!fromAddr) return null;

  for (const lead of input.leads) {
    const emails = leadContactEmails(lead);
    if (emails.some((e) => fromAddr === e || fromAddr.endsWith(e))) return lead.id;
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
}): boolean {
  // Bounce DSNs and OOO must not pause sequences as a human reply.
  if (isDeliveryStatusNotification(input.message) || isLikelyAutoReply(input.message)) {
    return false;
  }
  const fromAddr = extractEmailAddress(input.message.from);
  if (!fromAddr) return false;
  const mailbox = input.mailboxEmail?.trim().toLowerCase();
  if (mailbox && fromAddr === mailbox) return false;
  const contacts = leadContactEmails(input.lead);
  return contacts.some((e) => fromAddr === e || fromAddr.includes(e));
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
