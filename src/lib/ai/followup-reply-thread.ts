import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import { replyTextOnly } from "@/lib/email/strip-quoted-reply";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

const TRANSCRIPT_LOAD_LIMIT = 24;
const TRANSCRIPT_MESSAGES = 12;
const TRANSCRIPT_SNIPPET_MAX = 1_200;
const VERBATIM_BODY_MAX = 2_000;

/** Threading headers that let a regenerated sequence land inside the existing conversation. */
export type FollowupThreadAnchor = {
  /** RFC 5322 Message-ID of the lead's reply (no angle brackets). */
  inReplyTo: string;
  referenceIds?: string[];
  /** Subject of the anchored message, before `Re:` normalization. */
  subject?: string;
};

type ThreadMessage = {
  direction: "inbound" | "outbound";
  date: string;
  subject: string;
  from: string;
  body: string;
};

export type FollowupReplyThread = {
  /** Chronological `[THEM] / [US]` transcript, oldest first. */
  transcript: string;
  latestInbound?: ThreadMessage;
  lastOutbound?: ThreadMessage;
  anchor?: FollowupThreadAnchor;
};

function cleanBody(value: string | undefined, max: number): string {
  return replyTextOnly(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Load the lead's stored mail as prompt-ready thread context plus the headers
 * needed to reply into the same thread.
 *
 * Follow-up generation previously only saw email history buried in the lead
 * context JSON, so regenerated copy read like a fresh cold sequence instead of
 * an answer to what the prospect actually wrote.
 */
export async function buildFollowupReplyThread(input: {
  organizationId: string;
  leadId: string;
}): Promise<FollowupReplyThread> {
  const rows = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: input.leadId,
    limit: TRANSCRIPT_LOAD_LIMIT,
  });
  if (rows.length === 0) return { transcript: "" };

  const chronological = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const transcript = chronological
    .slice(-TRANSCRIPT_MESSAGES)
    .map((row) => {
      const who = row.direction === "inbound" ? "THEM" : "US";
      const body = cleanBody(row.bodyText || row.preview, TRANSCRIPT_SNIPPET_MAX);
      return `[${who}] ${row.date} · ${row.subject}\nFrom: ${row.from}\n${body}`;
    })
    .join("\n\n");

  const toThreadMessage = (row: (typeof chronological)[number]): ThreadMessage => ({
    direction: row.direction,
    date: row.date,
    subject: row.subject,
    from: row.from,
    body: cleanBody(row.bodyText || row.preview, VERBATIM_BODY_MAX),
  });

  const latestInboundRow = chronological.findLast((r) => r.direction === "inbound");
  const lastOutboundRow = chronological.findLast((r) => r.direction === "outbound");

  const inReplyTo = normalizeMessageId(latestInboundRow?.messageId);
  const anchor: FollowupThreadAnchor | undefined =
    latestInboundRow && inReplyTo
      ? {
          inReplyTo,
          referenceIds: [...(latestInboundRow.referenceIds ?? []), inReplyTo]
            .map((id) => normalizeMessageId(id))
            .filter((id): id is string => Boolean(id))
            .filter((id, i, all) => all.indexOf(id) === i)
            .slice(-50),
          subject: latestInboundRow.subject || undefined,
        }
      : undefined;

  return {
    transcript,
    latestInbound: latestInboundRow ? toThreadMessage(latestInboundRow) : undefined,
    lastOutbound: lastOutboundRow ? toThreadMessage(lastOutboundRow) : undefined,
    anchor,
  };
}

/** Prompt section carrying the conversation so far. */
export function formatFollowupThreadBlock(thread: FollowupReplyThread): string {
  if (!thread.transcript) return "(no prior email thread stored for this lead)";
  return [
    "Conversation so far, oldest first. [THEM] = the prospect, [US] = this rep's mailbox.",
    "",
    thread.transcript,
  ].join("\n");
}

/**
 * Replan section for regeneration. The prospect's own words are repeated here,
 * next to the replan instruction, because that is the single fact the new
 * cadence has to answer.
 */
export function formatFollowupRegenerateBlock(
  regenerateContext: string | undefined,
  thread: FollowupReplyThread,
): string {
  const reason = regenerateContext?.trim();
  if (!reason && !thread.latestInbound) return "(none)";

  const parts: string[] = [];
  if (reason) parts.push(reason);

  if (thread.lastOutbound) {
    parts.push(
      [
        `THE LAST EMAIL WE SENT (${thread.lastOutbound.date}, subject "${thread.lastOutbound.subject}"):`,
        thread.lastOutbound.body || "(body not stored)",
      ].join("\n"),
    );
  }

  if (thread.latestInbound) {
    parts.push(
      [
        `THEIR REPLY, VERBATIM (${thread.latestInbound.date}, from ${thread.latestInbound.from}):`,
        thread.latestInbound.body || "(body not stored)",
        "",
        "This reply is the brief. Step 1 continues this conversation: answer what they actually said, in their words and register, and move it forward.",
        "Do not draft a cold opener, do not reintroduce yourself or the company, and do not restate the pitch they already read.",
        "Do not write a content-free check-in (no \"just checking in\", \"are you back\", \"following up\", \"circling back\"). Every step must carry a new, specific reason to reply.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}
