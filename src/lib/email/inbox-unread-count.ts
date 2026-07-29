import { groupInboundIntoThreads } from "@/lib/email/thread-inbound";
import {
  ALL_MAILBOXES_ID,
  getActiveMailbox,
  type EmailAccountStore,
} from "@/stores/email-account-store";

/** Matches inbox page initial IMAP list size (newest messages). */
export const INBOX_IMAP_HEAD_LIMIT = 800;

export function countUnreadInboxThreads(
  state: Pick<EmailAccountStore, "inboundByMailbox" | "mailboxes" | "activeMailboxId">,
): number {
  if (state.activeMailboxId === ALL_MAILBOXES_ID) {
    // Cap per-mailbox work so sidebar badges stay cheap with many mailboxes.
    const perMailboxCap = 100;
    return state.mailboxes.reduce((total, mailbox) => {
      const messages = state.inboundByMailbox[mailbox.id] ?? [];
      const head = messages.length > perMailboxCap ? messages.slice(0, perMailboxCap) : messages;
      return total + groupInboundIntoThreads(head).filter((t) => t.hasUnread).length;
    }, 0);
  }
  const account = getActiveMailbox(state);
  const inbound = state.inboundByMailbox[account.id] ?? [];
  return groupInboundIntoThreads(inbound).filter((t) => t.hasUnread).length;
}

export function formatUnreadBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
