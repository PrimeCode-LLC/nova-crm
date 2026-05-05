import type { MailInbound } from "@/lib/email-account-types";

/** Strip angle brackets and whitespace for stable Message-ID comparison. */
export function normalizeMessageId(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const inner = s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1).trim() : s;
  return inner || undefined;
}

/** Outlook-style title: remove Re:/Fwd: noise for the thread row. */
export function conversationSubject(subject: string | undefined): string {
  const s = (subject ?? "").trim() || "(no subject)";
  let out = s;
  const re = /^(re|fwd|fw|aw|wg|sv|vs|antw|enc)\s*:\s*/i;
  for (let i = 0; i < 8 && re.test(out); i++) {
    out = out.replace(re, "").trim();
  }
  return out || "(no subject)";
}

function splitReferencesString(s: string): string[] {
  const matches = s.match(/<[^>]+>/g);
  if (!matches?.length) return [];
  return matches.map((m) => normalizeMessageId(m)).filter((x): x is string => Boolean(x));
}

export function parseReferencesField(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") out.push(...splitReferencesString(item));
      else if (item && typeof item === "object" && "value" in item && typeof (item as { value: unknown }).value === "string") {
        out.push(...splitReferencesString((item as { value: string }).value));
      }
    }
    return out;
  }
  if (typeof raw === "string") return splitReferencesString(raw);
  return [];
}

export type MailThread = {
  /** Stable id (union-find root), e.g. `uid-12345`. */
  threadId: string;
  messages: MailInbound[];
  conversationSubject: string;
  latest: MailInbound;
  hasUnread: boolean;
};

function uidKey(m: MailInbound): string {
  return `uid-${m.uid}`;
}

/**
 * Groups IMAP messages into conversation threads using Message-ID, In-Reply-To,
 * and References — same signals Outlook and other clients use (RFC 5322).
 */
export function groupInboundIntoThreads(messages: MailInbound[]): MailThread[] {
  if (messages.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const byUid = new Map<number, MailInbound>();
  const normIdToUid = new Map<string, number>();

  for (const m of messages) {
    byUid.set(m.uid, m);
    const mid = normalizeMessageId(m.messageId);
    if (mid && !normIdToUid.has(mid)) normIdToUid.set(mid, m.uid);
  }

  for (const m of messages) {
    const self = uidKey(m);
    const irt = normalizeMessageId(m.inReplyTo);
    if (irt && normIdToUid.has(irt)) {
      union(self, uidKey(byUid.get(normIdToUid.get(irt)!)!));
    }
    const refs = m.referenceIds ?? [];
    for (let i = refs.length - 1; i >= 0; i--) {
      const r = normalizeMessageId(refs[i]);
      if (r && normIdToUid.has(r)) {
        union(self, uidKey(byUid.get(normIdToUid.get(r)!)!));
        break;
      }
    }
  }

  const buckets = new Map<string, MailInbound[]>();
  for (const m of messages) {
    const root = find(uidKey(m));
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root)!.push(m);
  }

  const threads: MailThread[] = [];
  for (const [, msgs] of buckets) {
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    const latest = msgs[msgs.length - 1]!;
    const rootSubject = msgs[0]?.subject ?? latest.subject;
    const threadId = find(uidKey(msgs[0]!));
    threads.push({
      threadId,
      messages: msgs,
      conversationSubject: conversationSubject(rootSubject),
      latest,
      hasUnread: msgs.some((x) => !x.seen),
    });
  }

  threads.sort((a, b) => b.latest.date.localeCompare(a.latest.date));
  return threads;
}
