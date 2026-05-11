import { simpleParser } from "mailparser";
import type { AddressObject, Attachment, ParsedMail } from "mailparser";
import type { MailInboundAttachment } from "@/lib/email-account-types";
import {
  normalizeMessageId,
  parseReferencesField,
} from "@/lib/email/thread-inbound";

/** Include attachment bytes in JSON only below this size (per file). */
const MAX_ATTACHMENT_BYTES_EMBED = 450_000;

function formatAddressObjects(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return "";
  const objs = Array.isArray(addr) ? addr : [addr];
  const chunks: string[] = [];
  for (const o of objs) {
    const line = formatImapAddressList(o.value);
    if (line) chunks.push(line);
  }
  return chunks.join(", ");
}

function extractAttachmentsFromParsed(parsed: ParsedMail): MailInboundAttachment[] {
  const list: MailInboundAttachment[] = [];
  for (const att of parsed.attachments ?? []) {
    const a = att as Attachment;
    if (a.related && !a.filename?.trim()) continue;
    const buf = Buffer.isBuffer(a.content) ? a.content : null;
    const sizeBytes = buf ? buf.length : a.size || 0;
    const filename =
      a.filename?.trim() ||
      (a.cid ? `embedded-${String(a.cid).replace(/[<>]/g, "")}.bin` : "attachment");
    const mimeType = a.contentType || "application/octet-stream";
    const row: MailInboundAttachment = { filename, mimeType, sizeBytes };
    const canEmbed =
      buf &&
      sizeBytes > 0 &&
      sizeBytes <= MAX_ATTACHMENT_BYTES_EMBED &&
      (!a.related || Boolean(a.filename?.trim()));
    if (canEmbed) row.contentBase64 = buf.toString("base64");
    list.push(row);
  }
  return list;
}

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
  cc: string;
  attachments: MailInboundAttachment[];
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
}> {
  const parsed = await simpleParser(source);
  const bodyText = (parsed.text || "").trim();
  let bodyHtml: string | undefined;
  if (typeof parsed.html === "string" && parsed.html.length > 0) {
    bodyHtml = parsed.html;
  }
  const cc = formatAddressObjects(parsed.cc);
  const attachments = extractAttachmentsFromParsed(parsed);
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
    cc,
    attachments,
    messageId: messageId ?? undefined,
    inReplyTo: inReplyTo ?? undefined,
    referenceIds: refParsed.length > 0 ? refParsed : undefined,
  };
}

export function envelopeHeaderFields(env: {
  subject?: string;
  from?: { name?: string; address?: string }[];
  to?: { name?: string; address?: string }[];
  cc?: { name?: string; address?: string }[];
  date?: Date;
}): {
  subj: string;
  from: string;
  to: string;
  cc: string;
  envExt: EnvelopeExt | undefined;
} {
  const subj = env.subject?.trim() || "(no subject)";
  const from = formatImapAddressList(env.from) || "Unknown";
  const to = formatImapAddressList(env.to);
  const cc = formatImapAddressList(env.cc);
  const envExt = env as EnvelopeExt | undefined;
  return { subj, from, to, cc, envExt };
}
