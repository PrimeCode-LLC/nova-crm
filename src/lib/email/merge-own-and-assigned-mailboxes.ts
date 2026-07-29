import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { normalizeCrmEmailKey } from "@/lib/crm-dedup-keys";

/**
 * Merge a member’s own mailbox profiles with mailboxes assigned from teammates.
 *
 * Prefer assigned rows (with `dataOwnerUid`) when the same mailbox id or email also
 * exists under the viewer. Credential-less local copies otherwise win the merge and
 * cause “IMAP credentials missing” for salespeople who were assigned a working inbox.
 */
export function mergeOwnAndAssignedMailboxes(
  own: readonly EmailMailboxSettings[],
  assigned: readonly EmailMailboxSettings[],
): EmailMailboxSettings[] {
  if (assigned.length === 0) return [...own];

  const assignedById = new Map(assigned.map((m) => [m.id, m]));
  const assignedEmails = new Set(
    assigned
      .map((m) => normalizeCrmEmailKey(m.emailAddress))
      .filter((k): k is string => Boolean(k)),
  );

  const ownKept = own.filter((m) => {
    if (assignedById.has(m.id)) return false;
    const email = normalizeCrmEmailKey(m.emailAddress);
    if (email && assignedEmails.has(email)) return false;
    return true;
  });

  const ownIds = new Set(ownKept.map((m) => m.id));
  return [...ownKept, ...assigned.filter((m) => !ownIds.has(m.id))];
}
