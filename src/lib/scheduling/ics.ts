import type { Meeting } from "@/lib/types";

export type IcsPartstat = "ACCEPTED" | "DECLINED" | "TENTATIVE";

export type ParsedInboundIcs = {
  uid: string;
  method: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmails: string[];
};

function formatIcsDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function unescapeIcs(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function meetingLocationLabel(meeting: Meeting): string {
  return (
    meeting.locationDetails?.trim() ||
    (meeting.locationType === "google_meet"
      ? "Google Meet"
      : meeting.locationType === "zoom"
        ? "Zoom"
        : meeting.locationType === "teams"
          ? "Microsoft Teams"
          : meeting.locationType === "phone"
            ? "Phone call"
            : "Meeting")
  );
}

export function buildMeetingIcs(meeting: Meeting, organizerEmail: string): string {
  const uid = meeting.inboundInviteUid?.trim() || `${meeting.id}@nova-crm`;
  const now = new Date().toISOString();
  const loc = meetingLocationLabel(meeting);

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

export function buildMeetingIcsReply(input: {
  uid: string;
  summary: string;
  startAt: string;
  endAt: string;
  organizerEmail: string;
  attendeeEmail: string;
  attendeeName?: string;
  partstat: IcsPartstat;
  description?: string;
  location?: string;
}): string {
  const now = new Date().toISOString();
  const cn = input.attendeeName?.trim()
    ? `;CN=${escapeIcs(input.attendeeName.trim())}`
    : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nova CRM//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(input.startAt)}`,
    `DTEND:${formatIcsDate(input.endAt)}`,
    `SUMMARY:${escapeIcs(input.summary)}`,
    `DESCRIPTION:${escapeIcs(input.description ?? "")}`,
    `LOCATION:${escapeIcs(input.location ?? "")}`,
    `ORGANIZER:mailto:${input.organizerEmail}`,
    `ATTENDEE${cn};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${input.partstat}:mailto:${input.attendeeEmail}`,
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Unfold ICS lines (RFC 5545) then split into logical lines. */
function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const physical = normalized.split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

function parseIcsProp(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = left.indexOf(";");
  const name = (semi >= 0 ? left.slice(0, semi) : left).toUpperCase();
  const params = semi >= 0 ? left.slice(semi + 1) : "";
  return { name, params, value };
}

function mailtoFrom(value: string): string | undefined {
  const m = /mailto:([^\s;]+)/i.exec(value);
  if (m?.[1]) return m[1].trim().toLowerCase();
  if (value.includes("@") && !value.includes(":")) return value.trim().toLowerCase();
  return undefined;
}

function cnFromParams(params: string): string | undefined {
  const m = /CN=([^;]+)/i.exec(params);
  if (!m?.[1]) return undefined;
  return unescapeIcs(m[1].replace(/^"|"$/g, "").trim());
}

/** Parse ICS datetime (UTC Z or floating / with TZID ignored → treat as UTC-ish ISO). */
function icsDateToIso(value: string): string | null {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    const y = v.slice(0, 4);
    const mo = v.slice(4, 6);
    const d = v.slice(6, 8);
    return new Date(`${y}-${mo}-${d}T00:00:00.000Z`).toISOString();
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseInboundIcs(raw: string | Buffer): ParsedInboundIcs | null {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  if (!text.includes("BEGIN:VEVENT")) return null;

  const lines = unfoldIcs(text);
  let method = "REQUEST";
  let uid = "";
  let summary = "";
  let description: string | undefined;
  let location: string | undefined;
  let startAt = "";
  let endAt = "";
  let organizerEmail: string | undefined;
  let organizerName: string | undefined;
  const attendeeEmails: string[] = [];
  let inEvent = false;

  for (const line of lines) {
    const prop = parseIcsProp(line);
    if (!prop) continue;
    if (prop.name === "METHOD") {
      method = prop.value.trim().toUpperCase();
      continue;
    }
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      inEvent = true;
      continue;
    }
    if (prop.name === "END" && prop.value.toUpperCase() === "VEVENT") {
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    switch (prop.name) {
      case "UID":
        uid = prop.value.trim();
        break;
      case "SUMMARY":
        summary = unescapeIcs(prop.value);
        break;
      case "DESCRIPTION":
        description = unescapeIcs(prop.value);
        break;
      case "LOCATION":
        location = unescapeIcs(prop.value);
        break;
      case "DTSTART": {
        const iso = icsDateToIso(prop.value);
        if (iso) startAt = iso;
        break;
      }
      case "DTEND": {
        const iso = icsDateToIso(prop.value);
        if (iso) endAt = iso;
        break;
      }
      case "ORGANIZER": {
        organizerEmail = mailtoFrom(prop.value) ?? mailtoFrom(prop.params);
        organizerName = cnFromParams(prop.params);
        break;
      }
      case "ATTENDEE": {
        const email = mailtoFrom(prop.value);
        if (email) attendeeEmails.push(email);
        break;
      }
      default:
        break;
    }
  }

  if (!uid || !startAt) return null;
  if (!endAt) {
    endAt = new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString();
  }

  return {
    uid,
    method,
    summary: summary || "Meeting",
    description,
    location,
    startAt,
    endAt,
    organizerEmail,
    organizerName,
    attendeeEmails,
  };
}

export function parseInboundIcsFromBase64(contentBase64: string): ParsedInboundIcs | null {
  try {
    if (typeof Buffer !== "undefined") {
      return parseInboundIcs(Buffer.from(contentBase64, "base64"));
    }
    const binary = atob(contentBase64);
    return parseInboundIcs(binary);
  } catch {
    return null;
  }
}

export function isCalendarAttachment(filename: string, mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  const name = filename.toLowerCase();
  return (
    mime.includes("text/calendar") ||
    mime === "application/ics" ||
    name.endsWith(".ics")
  );
}
