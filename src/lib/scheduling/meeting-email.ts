import { resolveOrgTimezone } from "@/lib/org-timezone";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/defaults";
import { SITE } from "@/lib/site";
import type { Meeting, Organization, SchedulingLink } from "@/lib/types";

export function renderMeetingConfirmationEmail(input: {
  meeting: Meeting;
  organization: Organization;
  link?: SchedulingLink;
  hostDisplayName: string;
}): { subject: string; html: string; text: string } {
  const { meeting, organization, hostDisplayName } = input;
  const when = formatMeetingWhen(meeting);
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
    <p style="font-size:12px;color:#888;margin-top:32px;">A calendar invite (.ics) is attached - add it to your calendar or Accept in your email client.</p>
  </div>
</body></html>`;

  return { subject, html, text };
}

/**
 * "Monday, October 26 · 9:45 AM EDT" in the meeting's own timezone (the
 * server's zone was used before, which is UTC in production — QA 2.3).
 */
export function formatMeetingWhen(meeting: Pick<Meeting, "startAt" | "timezone">): string {
  const timeZone = resolveOrgTimezone(meeting.timezone, { fallback: DEFAULT_TIMEZONE });
  const date = new Date(meeting.startAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
  return `${day} · ${time}`;
}

/** Sent to the attendee when a scheduled meeting is cancelled (QA 2.3 / SCH-06). */
export function renderMeetingCancellationEmail(input: {
  meeting: Meeting;
  organization: Pick<Organization, "name">;
  hostDisplayName: string;
}): { subject: string; html: string; text: string } {
  const { meeting, organization, hostDisplayName } = input;
  const when = formatMeetingWhen(meeting);
  const subject = `Cancelled: ${meeting.title} with ${hostDisplayName}`;
  const text = [
    `Hi ${meeting.attendeeName},`,
    "",
    `Your meeting has been cancelled.`,
    "",
    `${meeting.title}`,
    when,
    `Host: ${hostDisplayName}`,
    `Organization: ${organization.name}`,
    "",
    `- ${SITE.name}`,
  ].join("\n");
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;line-height:1.5;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <p style="color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(organization.name)}</p>
    <h1 style="font-size:22px;margin:8px 0 16px;">Meeting cancelled</h1>
    <p>Hi ${escapeHtml(meeting.attendeeName)},</p>
    <p><s>${escapeHtml(meeting.title)}</s><br/>
    ${escapeHtml(when)}<br/>
    with ${escapeHtml(hostDisplayName)}</p>
    <p style="font-size:12px;color:#888;margin-top:32px;">The calendar cancellation (.ics) is attached so the event is removed from your calendar.</p>
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
