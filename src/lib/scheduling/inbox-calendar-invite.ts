import {
  isCalendarAttachment,
  parseInboundIcsFromBase64,
  type ParsedInboundIcs,
} from "@/lib/scheduling/ics";
import type { MailInboundAttachment } from "@/lib/email-account-types";

export function findCalendarInviteAttachment(
  attachments: MailInboundAttachment[] | undefined,
): MailInboundAttachment | null {
  if (!attachments?.length) return null;
  return (
    attachments.find(
      (a) =>
        a.isCalendarInvite ||
        isCalendarAttachment(a.filename, a.mimeType),
    ) ?? null
  );
}

export function parseInviteFromAttachments(
  attachments: MailInboundAttachment[] | undefined,
): { attachment: MailInboundAttachment; invite: ParsedInboundIcs } | null {
  const attachment = findCalendarInviteAttachment(attachments);
  if (!attachment?.contentBase64) return null;
  const invite = parseInboundIcsFromBase64(attachment.contentBase64);
  if (!invite) return null;
  if (invite.method && invite.method !== "REQUEST" && invite.method !== "PUBLISH") {
    return null;
  }
  return { attachment, invite };
}

/** Heuristic for Calendly / external booking confirmation emails. */
export function looksLikeExternalBookingConfirmation(input: {
  from?: string;
  subject?: string;
  bodyText?: string;
  hasCalendarInvite?: boolean;
}): boolean {
  if (input.hasCalendarInvite) return true;
  const hay = `${input.from ?? ""} ${input.subject ?? ""} ${input.bodyText ?? ""}`.toLowerCase();
  return (
    hay.includes("calendly.com") ||
    hay.includes("scheduled an event") ||
    (hay.includes("new event") && hay.includes("calendly")) ||
    hay.includes("invitee:") ||
    hay.includes("event scheduled") ||
    hay.includes("has scheduled") ||
    hay.includes("booking confirmed") ||
    hay.includes("meeting confirmed")
  );
}
