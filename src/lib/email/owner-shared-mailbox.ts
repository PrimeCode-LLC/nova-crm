import type { EmailMailboxSettings } from "@/lib/email-account-types";

/** Credential owner for a mailbox in the viewer's sendable list. */
export function mailboxCredentialOwnerUid(
  mailbox: Pick<EmailMailboxSettings, "dataOwnerUid">,
  viewerUid: string,
): string {
  return mailbox.dataOwnerUid?.trim() || viewerUid.trim();
}

/**
 * Whether the lead's owner can also send from this mailbox (from the scheduler's pool).
 *
 * True when:
 * - lead has no owner (open queue) or the scheduler is the owner
 * - the mailbox credentials belong to the lead owner (scheduler has shared send access)
 * - the lead owner is in `assignedUserIds` on this mailbox
 */
export function leadOwnerCanSendFromMailbox(input: {
  mailbox: Pick<EmailMailboxSettings, "dataOwnerUid" | "assignedUserIds">;
  leadOwnerId: string | null | undefined;
  viewerUid: string;
}): boolean {
  const ownerId = (input.leadOwnerId ?? "").trim();
  const viewerUid = input.viewerUid.trim();
  if (!ownerId || ownerId === viewerUid) return true;

  const dataOwner = mailboxCredentialOwnerUid(input.mailbox, viewerUid);
  if (dataOwner === ownerId) return true;
  if ((input.mailbox.assignedUserIds ?? []).includes(ownerId)) return true;
  return false;
}

/** Mailboxes from the selected pool that the lead owner can also send from. */
export function filterMailboxesSharedWithLeadOwner(input: {
  mailboxes: readonly EmailMailboxSettings[];
  leadOwnerId: string | null | undefined;
  viewerUid: string;
}): EmailMailboxSettings[] {
  return input.mailboxes.filter((mailbox) =>
    leadOwnerCanSendFromMailbox({
      mailbox,
      leadOwnerId: input.leadOwnerId,
      viewerUid: input.viewerUid,
    }),
  );
}

export type OwnerMailboxMatchGroup = {
  ownerId: string;
  /** Empty ownerId → open queue. */
  leadCount: number;
  /** Scheduler is this owner (or open queue) — full pool applies. */
  isSelfOrOpen: boolean;
  sharedMailboxIds: string[];
};

/**
 * Group ready leads by owner and report which selected mailboxes each owner shares
 * with the scheduler. Used for preflight UX in bulk schedule.
 */
export function buildOwnerMailboxMatchGroups(input: {
  leadOwnerIds: readonly (string | null | undefined)[];
  selectedMailboxes: readonly EmailMailboxSettings[];
  viewerUid: string;
}): OwnerMailboxMatchGroup[] {
  const counts = new Map<string, number>();
  for (const raw of input.leadOwnerIds) {
    const key = (raw ?? "").trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const viewerUid = input.viewerUid.trim();
  const groups: OwnerMailboxMatchGroup[] = [];
  for (const [ownerId, leadCount] of counts) {
    const isSelfOrOpen = !ownerId || ownerId === viewerUid;
    const sharedMailboxIds = isSelfOrOpen
      ? input.selectedMailboxes.map((m) => m.id)
      : filterMailboxesSharedWithLeadOwner({
          mailboxes: input.selectedMailboxes,
          leadOwnerId: ownerId,
          viewerUid,
        }).map((m) => m.id);
    groups.push({ ownerId, leadCount, isSelfOrOpen, sharedMailboxIds });
  }

  groups.sort((a, b) => {
    if (a.isSelfOrOpen !== b.isSelfOrOpen) return a.isSelfOrOpen ? -1 : 1;
    if (b.leadCount !== a.leadCount) return b.leadCount - a.leadCount;
    return a.ownerId.localeCompare(b.ownerId);
  });
  return groups;
}

export function ownerSharedMailboxSkipReason(ownerDisplayName: string): string {
  const name = ownerDisplayName.trim() || "owner";
  return `No shared inbox with ${name}`;
}
