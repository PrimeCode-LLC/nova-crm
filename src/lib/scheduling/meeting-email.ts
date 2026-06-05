import { format } from "date-fns";
import { SITE } from "@/lib/site";
import type { Meeting, Organization, SchedulingLink } from "@/lib/types";

export function renderMeetingConfirmationEmail(input: {
  meeting: Meeting;
  organization: Organization;
  link?: SchedulingLink;
  hostDisplayName: string;
}): { subject: string; html: string; text: string } {
  const { meeting, organization, hostDisplayName } = input;
  const when = format(new Date(meeting.startAt), "EEEE, MMMM d · h:mm a");
  const subject = `Confirmed: ${meeting.title} with ${hostDisplayName}`;

  const locationLine =
    meeting.locationType === "google_meet" ||
    meeting.locationType === "zoom" ||
    meeting.locationType === "teams"
      ? "Video conferencing details will be shared separately."
      : meeting.locationDetails || "As discussed";

  const text = [
    `Hi ${meeting.attendeeName},`,
    "",
    `Your meeting is confirmed.`,
    "",
    `${meeting.title}`,
    when,
    `Host: ${hostDisplayName}`,
    `Organization: ${organization.name}`,
    `Location: ${locationLine}`,
    "",
    meeting.attendeeNotes?.trim() ? `Notes: ${meeting.attendeeNotes.trim()}` : "",
    "",
    `- ${SITE.name}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;line-height:1.5;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <p style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(organization.name)}</p>
    <h1 style="font-size:22px;margin:8px 0 16px;">You're scheduled</h1>
    <p>Hi ${escapeHtml(meeting.attendeeName)},</p>
    <p><strong>${escapeHtml(meeting.title)}</strong><br/>
    ${escapeHtml(when)}<br/>
    with ${escapeHtml(hostDisplayName)}</p>
    <p style="color:#444;">${escapeHtml(locationLine)}</p>
    ${meeting.attendeeNotes?.trim() ? `<p style="color:#666;font-size:14px;">Notes: ${escapeHtml(meeting.attendeeNotes.trim())}</p>` : ""}
    <p style="font-size:12px;color:#888;margin-top:32px;">A calendar invite is attached when email delivery is configured.</p>
  </div>
</body></html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
