import type { MailInboundAttachment } from "@/lib/email-account-types";

export const MAX_COMPOSE_ATTACHMENTS = 5;
export const MAX_COMPOSE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type ComposeAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
};

export function formatComposeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function composeAttachmentsFromInbound(
  attachments: MailInboundAttachment[] | undefined,
): ComposeAttachment[] {
  return (attachments ?? [])
    .filter(
      (attachment): attachment is MailInboundAttachment & { contentBase64: string } =>
        Boolean(attachment.contentBase64),
    )
    .slice(0, MAX_COMPOSE_ATTACHMENTS)
    .map((attachment, index) => ({
      id: `forward-${index}-${attachment.filename}`,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      contentBase64: attachment.contentBase64,
    }));
}
