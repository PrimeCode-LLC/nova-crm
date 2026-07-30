import type { MailInbound, MailSent } from "@/lib/email-account-types";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import { conversationSubject, normalizeMessageId } from "@/lib/email/thread-inbound";

export type LeadEmailMessage =
  | { key: string; mailboxId: string; direction: "inbound"; message: MailInbound }
  | { key: string; mailboxId: string; direction: "sent"; message: MailSent };

export type LeadEmailConversation = {
  id: string;
  mailboxId: string;
  subject: string;
  messages: LeadEmailMessage[];
  latest: LeadEmailMessage;
  hasUnread: boolean;
};

function at(message: LeadEmailMessage): string {
  return message.direction === "inbound" ? message.message.date : message.message.sentAt;
}

function normalizedSubject(message: LeadEmailMessage): string {
  return conversationSubject(message.message.subject).toLowerCase();
}

function messageId(message: LeadEmailMessage): string | undefined {
  return normalizeMessageId(message.message.messageId);
}

function parentIds(message: LeadEmailMessage): string[] {
  const values = [
    message.message.inReplyTo,
    ...(message.message.referenceIds ?? []),
  ];
  return values
    .map((value) => normalizeMessageId(value))
    .filter((value): value is string => Boolean(value));
}

function hasRfcThreadMetadata(message: LeadEmailMessage): boolean {
  return Boolean(messageId(message) || parentIds(message).length > 0);
}

function participantKey(message: LeadEmailMessage): string {
  return [...extractEmailAddresses(
    message.message.from,
    message.message.to,
    message.message.cc,
  )]
    .sort()
    .join(",");
}

/**
 * Group lead mail across Inbox and Sent. RFC headers are authoritative; normalized
 * subject is a bounded fallback for older messages that were synced without headers.
 */
export function groupLeadEmailConversations(
  input: LeadEmailMessage[],
): LeadEmailConversation[] {
  if (input.length === 0) return [];

  const messages = [...input].sort((a, b) => at(a).localeCompare(at(b)));
  const parent = messages.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]!);
    return parent[index]!;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  // Prefer same-mailbox Message-ID matches; also allow cross-mailbox so an AI
  // reply sent from a fallback mailbox still lands in the inbound thread UI.
  const byMailboxAndMessageId = new Map<string, number>();
  const byMessageId = new Map<string, number>();
  messages.forEach((message, index) => {
    const id = messageId(message);
    if (!id) return;
    byMailboxAndMessageId.set(`${message.mailboxId}\0${id}`, index);
    byMessageId.set(id, index);
  });

  const parentResolved = new Set<number>();
  messages.forEach((message, index) => {
    for (const id of parentIds(message)) {
      const related =
        byMailboxAndMessageId.get(`${message.mailboxId}\0${id}`) ?? byMessageId.get(id);
      if (related != null) {
        union(index, related);
        parentResolved.add(index);
      }
    }
  });

  const fallbackWindows = new Map<
    string,
    { latestIndex: number; firstAt: number }
  >();
  const maxFallbackSpanMs = 45 * 24 * 60 * 60 * 1000;
  messages.forEach((message, index) => {
    const subject = normalizedSubject(message);
    if (!subject || subject === "(no subject)") return;
    const currentAt = new Date(at(message)).getTime();
    const key = `${subject}\0${participantKey(message)}`;
    const window = fallbackWindows.get(key);
    if (window) {
      const gap = currentAt - new Date(at(messages[window.latestIndex]!)).getTime();
      const span = currentAt - window.firstAt;
      const latest = messages[window.latestIndex]!;
      // Subject fallback when RFC parents did not resolve (missing Message-ID on
      // inbound, or orphan In-Reply-To). Still allow when one side has headers.
      const eitherUnresolved =
        !parentResolved.has(index) && !parentResolved.has(window.latestIndex);
      const bothLackParents =
        !hasRfcThreadMetadata(message) && !hasRfcThreadMetadata(latest);
      if (
        Number.isFinite(gap) &&
        Number.isFinite(span) &&
        gap >= 0 &&
        span >= 0 &&
        gap <= maxFallbackSpanMs &&
        span <= maxFallbackSpanMs &&
        (bothLackParents || eitherUnresolved)
      ) {
        union(index, window.latestIndex);
        window.latestIndex = index;
        return;
      }
    }
    fallbackWindows.set(key, {
      latestIndex: index,
      firstAt: currentAt,
    });
  });

  const buckets = new Map<number, LeadEmailMessage[]>();
  messages.forEach((message, index) => {
    const root = find(index);
    const bucket = buckets.get(root) ?? [];
    bucket.push(message);
    buckets.set(root, bucket);
  });

  return [...buckets.values()]
    .map((bucket): LeadEmailConversation => {
      bucket.sort((a, b) => at(a).localeCompare(at(b)));
      const latest = bucket[bucket.length - 1]!;
      const first = bucket[0]!;
      return {
        id: `${first.mailboxId}:${first.key}`,
        mailboxId: first.mailboxId,
        subject: conversationSubject(first.message.subject),
        messages: bucket,
        latest,
        hasUnread: bucket.some(
          (message) => message.direction === "inbound" && !message.message.seen,
        ),
      };
    })
    .sort((a, b) => at(b.latest).localeCompare(at(a.latest)));
}

export function leadEmailMessageAt(message: LeadEmailMessage): string {
  return at(message);
}
