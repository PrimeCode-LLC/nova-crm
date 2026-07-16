import type { Lead } from "@/lib/types";
import type { MailInbound, MailSent } from "@/lib/email-account-types";
import { extractEmailAddresses } from "@/lib/email/reply-compose";

/**
 * Whether this lead appears in unified inbox mail: manual message→lead link, or the lead’s
 * contact email appears on an IMAP inbound or locally stored sent row (same heuristic as the
 * lead detail “Emails” tab).
 */
export function leadHasConnectedInboxMail(input: {
  lead: Lead;
  linkedLeadByMessageId: Record<string, string>;
  inboundByMailbox: Record<string, MailInbound[]>;
  sent: MailSent[];
}): boolean {
  const { lead, linkedLeadByMessageId, inboundByMailbox, sent } = input;

  for (const linkedLeadId of Object.values(linkedLeadByMessageId)) {
    if (linkedLeadId === lead.id) return true;
  }

  const own = lead.contactEmail?.trim().toLowerCase();
  if (!own) return false;

  for (const messages of Object.values(inboundByMailbox)) {
    for (const m of messages) {
      if (extractEmailAddresses(m.from, m.to, m.cc).has(own)) return true;
    }
  }
  for (const m of sent) {
    if (extractEmailAddresses(m.from, m.to, m.cc).has(own)) return true;
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
