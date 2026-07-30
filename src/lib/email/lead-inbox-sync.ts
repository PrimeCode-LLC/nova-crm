import type { Lead } from "@/lib/types";
import type { MailInbound, MailSent } from "@/lib/email-account-types";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import { leadContactEmails } from "@/lib/followup-plans";

/**
 * Whether this lead appears in unified inbox mail: manual message→lead link, or any of the
 * lead’s contact emails appear on an IMAP inbound or locally stored sent row (same heuristic
 * as the lead detail “Emails” tab).
 */
export function leadHasConnectedInboxMail(input: {
  lead: Lead;
  linkedLeadByMessageId: Record<string, string>;
  inboundByMailbox: Record<string, MailInbound[]>;
  sent: MailSent[];
  /** Extra emails (e.g. personal) beyond lead.contactEmail. */
  extraEmails?: readonly (string | null | undefined)[];
}): boolean {
  const { lead, linkedLeadByMessageId, inboundByMailbox, sent } = input;

  for (const linkedLeadId of Object.values(linkedLeadByMessageId)) {
    if (linkedLeadId === lead.id) return true;
  }

  const emails = new Set(leadContactEmails(lead, ...(input.extraEmails ?? [])));
  if (emails.size === 0) return false;

  for (const messages of Object.values(inboundByMailbox)) {
    for (const m of messages) {
      for (const addr of extractEmailAddresses(m.from, m.to, m.cc)) {
        if (emails.has(addr)) return true;
      }
    }
  }
  for (const m of sent) {
    for (const addr of extractEmailAddresses(m.from, m.to, m.cc)) {
      if (emails.has(addr)) return true;
    }
  }
  return false;
}

/** Lead ids that currently match {@link leadHasConnectedInboxMail} for the given mail snapshot. */
export function buildInboxSyncedLeadIds(
  leads: Lead[],
  linkedLeadByMessageId: Record<string, string>,
  inboundByMailbox: Record<string, MailInbound[]>,
  sent: MailSent[],
): Set<string> {
  const ctx = { linkedLeadByMessageId, inboundByMailbox, sent };
  const out = new Set<string>();
  for (const lead of leads) {
    if (leadHasConnectedInboxMail({ lead, ...ctx })) out.add(lead.id);
  }
  return out;
}
