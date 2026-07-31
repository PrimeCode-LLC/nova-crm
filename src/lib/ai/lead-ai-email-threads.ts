import { replyTextOnly } from "@/lib/email/strip-quoted-reply";
import type { LeadMailMessage } from "@/lib/email/lead-mail-types";

export type LeadAiEmailMessage = {
  from: string;
  to?: string;
  date: string;
  direction?: "inbound" | "outbound";
  snippet: string;
};

export type LeadAiEmailThread = {
  subject: string;
  messages: LeadAiEmailMessage[];
};

const DEFAULT_MAX_THREADS = 20;
const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_SNIPPET_MAX = 2_000;

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function messageSnippet(row: Pick<LeadMailMessage, "direction" | "bodyText" | "preview">, max: number): string {
  const raw = (row.bodyText || row.preview || "").trim();
  if (!raw) return "";
  // Inbound often includes quoted history — keep the new reply body for the model.
  const text = row.direction === "inbound" ? replyTextOnly(raw) : raw;
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Group durable lead-mail (inbound + outbound) into chronological threads for AI context.
 */
export function buildLeadAiEmailThreadsFromMail(
  messages: LeadMailMessage[],
  options?: {
    maxThreads?: number;
    maxMessagesPerThread?: number;
    snippetMax?: number;
  },
): LeadAiEmailThread[] {
  const maxThreads = options?.maxThreads ?? DEFAULT_MAX_THREADS;
  const maxMessages = options?.maxMessagesPerThread ?? DEFAULT_MAX_MESSAGES;
  const snippetMax = options?.snippetMax ?? DEFAULT_SNIPPET_MAX;

  const threads = new Map<
    string,
    { subject: string; messages: LeadAiEmailMessage[]; lastAt: string }
  >();

  for (const row of messages) {
    const cleaned = normalizeSubject(row.subject) || "(no subject)";
    const key = cleaned.toLowerCase();
    const message: LeadAiEmailMessage = {
      from: row.from,
      to: row.to || undefined,
      date: row.date,
      direction: row.direction,
      snippet: messageSnippet(row, snippetMax),
    };
    const existing = threads.get(key);
    if (existing) {
      existing.messages.push(message);
      if (row.date > existing.lastAt) existing.lastAt = row.date;
    } else {
      threads.set(key, { subject: cleaned, messages: [message], lastAt: row.date });
    }
  }

  return Array.from(threads.values())
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, maxThreads)
    .map((t) => ({
      subject: t.subject,
      messages: t.messages
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(-maxMessages),
    }));
}
