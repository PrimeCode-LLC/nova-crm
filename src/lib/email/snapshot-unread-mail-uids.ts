import { groupInboundIntoThreads } from "@/lib/email/thread-inbound";
import type { MailInbound } from "@/lib/email-account-types";

/** UIDs of messages in threads that still have at least one unread message. */
export function snapshotUnreadMailUids(messages: MailInbound[]): Set<number> {
  const out = new Set<number>();
  for (const thread of groupInboundIntoThreads(messages)) {
    if (!thread.hasUnread) continue;
    for (const m of thread.messages) {
      if (!m.seen) out.add(m.uid);
    }
  }
  return out;
}

export function diffAddedUnreadUids(before: Set<number>, after: Set<number>): number[] {
  const added: number[] = [];
  for (const uid of after) {
    if (!before.has(uid)) added.push(uid);
  }
  return added;
}
