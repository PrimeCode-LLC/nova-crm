import type { MailInboundAttachment } from "@/lib/email-account-types";
import type { OutboundAttachment, OutboundAttachmentPayload } from "@/lib/email/outbound-attachments";

export const LEAD_MAIL_MAX_ATTACHMENTS = 5;
/** Per-file embed cap for Firestore lead-mail docs (metadata is always kept). */
export const LEAD_MAIL_ATTACHMENT_EMBED_BYTES = 80_000;
/** Calendar invites stay small and are needed for RSVP without a refetch. */
export const LEAD_MAIL_CALENDAR_EMBED_BYTES = 100_000;
/** Total embedded base64 budget across all attachments on one lead-mail doc. */
export const LEAD_MAIL_ATTACHMENT_EMBED_TOTAL_CHARS = 180_000;

export function sanitizeLeadMailAttachments(
  attachments: MailInboundAttachment[] | undefined,
): MailInboundAttachment[] | undefined {
  if (!attachments) return undefined;
  const out: MailInboundAttachment[] = [];
  let embeddedChars = 0;
  for (const att of attachments.slice(0, LEAD_MAIL_MAX_ATTACHMENTS)) {
    const filename = String(att.filename ?? "attachment").trim() || "attachment";
    const mimeType = String(att.mimeType ?? "application/octet-stream").trim() || "application/octet-stream";
    const sizeBytes = Number.isFinite(att.sizeBytes) ? Math.max(0, Math.floor(att.sizeBytes)) : 0;
    const row: MailInboundAttachment = {
      filename: filename.slice(0, 300),
      mimeType: mimeType.slice(0, 200),
      sizeBytes,
      ...(att.isCalendarInvite ? { isCalendarInvite: true } : {}),
    };
    const content = att.contentBase64?.trim();
    if (content) {
      const embedLimit = att.isCalendarInvite
        ? Math.max(LEAD_MAIL_ATTACHMENT_EMBED_BYTES, LEAD_MAIL_CALENDAR_EMBED_BYTES)
        : LEAD_MAIL_ATTACHMENT_EMBED_BYTES;
      const byteLen = sizeBytes || Math.floor((content.length * 3) / 4);
      if (
        byteLen > 0 &&
        byteLen <= embedLimit &&
        embeddedChars + content.length <= LEAD_MAIL_ATTACHMENT_EMBED_TOTAL_CHARS
      ) {
        row.contentBase64 = content;
        embeddedChars += content.length;
      }
    }
    out.push(row);
  }
  return out;
}

export function parseStoredLeadMailAttachments(raw: unknown): MailInboundAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: MailInboundAttachment[] = [];
  for (const item of raw.slice(0, LEAD_MAIL_MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const filename = String(rec.filename ?? "attachment").trim() || "attachment";
    const mimeType = String(rec.mimeType ?? rec.contentType ?? "application/octet-stream").trim();
    const sizeBytes = Number(rec.sizeBytes ?? rec.size ?? 0);
    const contentBase64 =
      typeof rec.contentBase64 === "string" && rec.contentBase64.trim() ? rec.contentBase64.trim() : undefined;
    parsed.push({
      filename,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: Number.isFinite(sizeBytes) ? Math.max(0, Math.floor(sizeBytes)) : 0,
      ...(contentBase64 ? { contentBase64 } : {}),
      ...(rec.isCalendarInvite === true ? { isCalendarInvite: true } : {}),
    });
  }
  return sanitizeLeadMailAttachments(parsed) ?? [];
}

export function outboundAttachmentsToLeadMail(
  attachments: OutboundAttachment[] | undefined,
): MailInboundAttachment[] | undefined {
  if (!attachments?.length) return [];
  return sanitizeLeadMailAttachments(
    attachments.map((att) => ({
      filename: att.filename,
      mimeType: att.contentType,
      sizeBytes: att.content.length,
      contentBase64: att.content.toString("base64"),
    })),
  );
}

export function outboundPayloadsToLeadMail(
  attachments: OutboundAttachmentPayload[] | undefined,
): MailInboundAttachment[] | undefined {
  if (!attachments?.length) return [];
  return sanitizeLeadMailAttachments(
    attachments.map((att) => {
      let sizeBytes = 0;
      try {
        sizeBytes = Buffer.from(att.contentBase64, "base64").length;
      } catch {
        sizeBytes = Math.floor((att.contentBase64.length * 3) / 4);
      }
      return {
        filename: att.filename,
        mimeType: att.mimeType,
        sizeBytes,
        contentBase64: att.contentBase64,
      };
    }),
  );
}

export function pickLeadMailAttachments(
  incoming: MailInboundAttachment[] | undefined,
  previous: MailInboundAttachment[] | undefined,
): MailInboundAttachment[] | undefined {
  const next = incoming === undefined ? undefined : sanitizeLeadMailAttachments(incoming) ?? [];
  if (next === undefined) return previous;
  if (previous === undefined) return next;
  if (next.length === 0) return previous.length ? previous : next;
  if (previous.length === 0) return next;
  const score = (list: MailInboundAttachment[]) =>
    list.reduce((sum, att) => sum + (att.contentBase64?.length ?? 0) + 8, 0);
  return score(next) >= score(previous) ? next : previous;
}
