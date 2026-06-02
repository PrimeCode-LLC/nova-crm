export const MAX_OUTBOUND_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type OutboundAttachment = { filename: string; content: Buffer; contentType: string };

export type OutboundAttachmentPayload = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export function parseOutboundAttachments(raw: unknown): OutboundAttachment[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };

  const out: OutboundAttachment[] = [];
  for (const item of raw.slice(0, MAX_OUTBOUND_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const filename = String(rec.filename ?? "attachment").trim() || "attachment";
    const contentBase64 = String(rec.contentBase64 ?? "").trim();
    if (!contentBase64) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(contentBase64, "base64");
    } catch {
      return { error: `Invalid attachment data for ${filename}` };
    }
    if (!buf.length) continue;
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return { error: `${filename} exceeds the 10 MB per-file limit` };
    }
    const contentType = String(rec.mimeType ?? rec.contentType ?? "application/octet-stream").trim();
    out.push({ filename, content: buf, contentType: contentType || "application/octet-stream" });
  }
  return out;
}

export function serializeOutboundAttachments(
  attachments: OutboundAttachment[],
): OutboundAttachmentPayload[] {
  return attachments.map((att) => ({
    filename: att.filename,
    mimeType: att.contentType,
    contentBase64: att.content.toString("base64"),
  }));
}
