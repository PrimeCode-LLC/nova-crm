import type { Meeting } from "@/lib/types";

function formatIcsDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildMeetingIcs(meeting: Meeting, organizerEmail: string): string {
  const uid = `${meeting.id}@nova-crm`;
  const now = new Date().toISOString();
  const loc =
    meeting.locationDetails?.trim() ||
    (meeting.locationType === "google_meet"
      ? "Google Meet"
      : meeting.locationType === "zoom"
        ? "Zoom"
        : meeting.locationType === "teams"
          ? "Microsoft Teams"
          : meeting.locationType === "phone"
            ? "Phone call"
            : "Meeting");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nova CRM//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(meeting.startAt)}`,
    `DTEND:${formatIcsDate(meeting.endAt)}`,
    `SUMMARY:${escapeIcs(meeting.title)}`,
    `DESCRIPTION:${escapeIcs(meeting.attendeeNotes ?? "")}`,
    `LOCATION:${escapeIcs(loc)}`,
    `ORGANIZER;CN=Nova CRM:mailto:${organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${meeting.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
