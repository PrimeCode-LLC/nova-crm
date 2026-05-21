import { groupInboundIntoThreads } from "@/lib/email/thread-inbound";
import {
  getActiveMailbox,
  type EmailAccountStore,
} from "@/stores/email-account-store";

/** Matches inbox page initial IMAP list size (newest messages). */
export const INBOX_IMAP_HEAD_LIMIT = 800;

export function countUnreadInboxThreads(
  state: Pick<EmailAccountStore, "inboundByMailbox" | "mailboxes" | "activeMailboxId">,
): number {
  const account = getActiveMailbox(state);
  const inbound = state.inboundByMailbox[account.id] ?? [];
  return groupInboundIntoThreads(inbound).filter((t) => t.hasUnread).length;
}

export function formatUnreadBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
