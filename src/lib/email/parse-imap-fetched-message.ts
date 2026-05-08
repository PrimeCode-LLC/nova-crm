import { simpleParser } from "mailparser";
import {
  normalizeMessageId,
  parseReferencesField,
} from "@/lib/email/thread-inbound";

export function formatImapAddressList(
  list: { name?: string; address?: string }[] | undefined,
): string {
  if (!list?.length) return "";
  return list
    .map((a) => {
      const addr = a.address?.trim() ?? "";
      if (a.name?.trim()) {
        return `${a.name.replace(/"/g, "")} <${addr}>`;
      }
      return addr;
    })
    .filter(Boolean)
    .join(", ");
}

type EnvelopeExt = {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
};

/** Parse RFC822 source into preview/body + normalized threading headers. */
export async function parseMailSourceFields(source: Buffer): Promise<{
  preview: string;
  bodyText: string;
  bodyHtml?: string;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
}> {
  const parsed = await simpleParser(source);
  let bodyText = (parsed.text || "").trim();
  let bodyHtml: string | undefined;
  if (typeof parsed.html === "string" && parsed.html.length > 0) {
    bodyHtml = parsed.html;
  }
  const p = bodyText.replace(/\s+/g, " ").trim();
  const preview = p.length > 220 ? `${p.slice(0, 220)}…` : p;
  const messageId = normalizeMessageId(
    typeof parsed.messageId === "string"
      ? parsed.messageId
      : parsed.messageId && typeof parsed.messageId === "object" && "value" in parsed.messageId
        ? String((parsed.messageId as { value?: string }).value ?? "")
        : undefined,
  );
  const inReplyTo = normalizeMessageId(
    typeof parsed.inReplyTo === "string"
      ? parsed.inReplyTo
      : parsed.inReplyTo && typeof parsed.inReplyTo === "object" && "value" in parsed.inReplyTo
        ? String((parsed.inReplyTo as { value?: string }).value ?? "")
        : undefined,
  );
  const refParsed = parseReferencesField(parsed.references);
  return {
    preview,
    bodyText,
    bodyHtml,
    messageId: messageId ?? undefined,
    inReplyTo: inReplyTo ?? undefined,
    referenceIds: refParsed.length > 0 ? refParsed : undefined,
  };
}

export function envelopeHeaderFields(env: {
  subject?: string;
  from?: { name?: string; address?: string }[];
  to?: { name?: string; address?: string }[];
  date?: Date;
}): {
  subj: string;
  from: string;
  to: string;
  envExt: EnvelopeExt | undefined;
} {
  const subj = env.subject?.trim() || "(no subject)";
  const from = formatImapAddressList(env.from) || "Unknown";
  const to = formatImapAddressList(env.to);
  const envExt = env as EnvelopeExt | undefined;
  return { subj, from, to, envExt };
}
