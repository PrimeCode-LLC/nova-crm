import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { resolveCalendarHostAccessServer } from "@/lib/scheduling/calendar-delegation-server";
import { insertGoogleEventsForHostsServer } from "@/lib/scheduling/google-calendar-events-server";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/defaults";
import type {
  Meeting,
  MeetingLocationType,
  MeetingSource,
  MeetingStatus,
} from "@/lib/types";

function tsToIso(t: Timestamp | undefined | null): string {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

const LOCATION_TYPES: MeetingLocationType[] = [
  "google_meet",
  "zoom",
  "teams",
  "phone",
  "in_person",
  "custom",
];

const MEETING_SOURCES: MeetingSource[] = [
  "public_link",
  "internal",
  "manual",
  "invite_rsvp",
  "email_thread",
  "external_booking",
];

export function meetingFromFirestoreDoc(id: string, data: DocumentData): Meeting {
  const statuses: MeetingStatus[] = ["scheduled", "completed", "cancelled", "no_show"];
  const googleRaw = data.googleEventIdsByHost;
  let googleEventIdsByHost: Record<string, string> | undefined;
  if (googleRaw && typeof googleRaw === "object" && !Array.isArray(googleRaw)) {
    googleEventIdsByHost = {};
    for (const [k, v] of Object.entries(googleRaw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) googleEventIdsByHost[k] = v.trim();
    }
    if (!Object.keys(googleEventIdsByHost).length) googleEventIdsByHost = undefined;
  }

  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    hostId: String(data.hostId ?? ""),
    hostName: typeof data.hostName === "string" ? data.hostName : undefined,
    internalHostIds: Array.isArray(data.internalHostIds)
      ? data.internalHostIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined,
    googleEventIdsByHost,
    bookedById: typeof data.bookedById === "string" ? data.bookedById : undefined,
    bookedByName: typeof data.bookedByName === "string" ? data.bookedByName : undefined,
    leadId: typeof data.leadId === "string" ? data.leadId : undefined,
    leadOwnerId: typeof data.leadOwnerId === "string" ? data.leadOwnerId : undefined,
    contactId: typeof data.contactId === "string" ? data.contactId : undefined,
    schedulingLinkId: typeof data.schedulingLinkId === "string" ? data.schedulingLinkId : undefined,
    title: String(data.title ?? "Meeting"),
    startAt: tsToIso(data.startAt as Timestamp | undefined),
    endAt: tsToIso(data.endAt as Timestamp | undefined),
    timezone: String(data.timezone ?? DEFAULT_TIMEZONE),
    status: statuses.includes(data.status as MeetingStatus)
      ? (data.status as MeetingStatus)
      : "scheduled",
    attendeeName: String(data.attendeeName ?? ""),
    attendeeEmail: String(data.attendeeEmail ?? ""),
    attendeeNotes: typeof data.attendeeNotes === "string" ? data.attendeeNotes : undefined,
    guestEmails: Array.isArray(data.guestEmails)
      ? data.guestEmails.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined,
    locationType: LOCATION_TYPES.includes(data.locationType as MeetingLocationType)
      ? (data.locationType as MeetingLocationType)
      : "google_meet",
    locationDetails: typeof data.locationDetails === "string" ? data.locationDetails : undefined,
    source: MEETING_SOURCES.includes(data.source as MeetingSource)
      ? (data.source as MeetingSource)
      : "manual",
    inboundInviteUid:
      typeof data.inboundInviteUid === "string" ? data.inboundInviteUid : undefined,
    organizerEmail: typeof data.organizerEmail === "string" ? data.organizerEmail : undefined,
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

function locationLabel(locationType: MeetingLocationType, locationDetails?: string): string {
  if (locationDetails?.trim()) return locationDetails.trim();
  if (locationType === "google_meet") return "Google Meet";
  if (locationType === "zoom") return "Zoom";
  if (locationType === "teams") return "Microsoft Teams";
  if (locationType === "phone") return "Phone call";
  return "Meeting";
}

export type PlaceMeetingInput = {
  organizationId: string;
  actorUid: string;
  actorName?: string;
  hostIds: string[];
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
  guestEmails?: string[];
  locationType?: MeetingLocationType;
  locationDetails?: string;
  source: MeetingSource;
  leadId?: string;
  leadOwnerId?: string;
  contactId?: string;
  schedulingLinkId?: string;
  inboundInviteUid?: string;
  organizerEmail?: string;
  /** Invite client on primary host Google event. */
  sendClientGoogleInvite?: boolean;
  /** When false, skip Google writes (e.g. Decline). Default true. */
  writeGoogle?: boolean;
  skipAccessCheck?: boolean;
};

export type PlaceMeetingResult =
  | {
      meeting: Meeting;
      googleEventIdsByHost: Record<string, string>;
      googleErrors: { hostId: string; error: string; needsReconnect?: boolean }[];
    }
  | { error: string };

/**
 * Create a Nova Meeting and place it on selected internal Google calendars
 * (self + calendars the actor may book via delegation).
 */
export async function placeMeetingServer(
  input: PlaceMeetingInput,
): Promise<PlaceMeetingResult> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const hostIds = [...new Set(input.hostIds.map((h) => h.trim()).filter(Boolean))];
  if (!hostIds.length) return { error: "Select at least one calendar" };

  if (!input.skipAccessCheck) {
    for (const hostId of hostIds) {
      const access = await resolveCalendarHostAccessServer({
        organizationId: input.organizationId,
        viewerUid: input.actorUid,
        hostId,
        action: "book",
        schedulingLinkId: input.schedulingLinkId,
      });
      if (!access.allowed) {
        return { error: `You cannot book on calendar for host ${hostId}` };
      }
    }
  }

  const primaryHostId = hostIds[0]!;
  const internalHostIds = hostIds.slice(1);
  const orgUsers = await listOrgUsersServer(input.organizationId);
  const host = orgUsers.find((u) => u.id === primaryHostId);
  const hostName =
    host?.displayName?.trim() || host?.email?.split("@")[0] || primaryHostId;

  const locationType = input.locationType ?? "google_meet";
  const locationDetails = input.locationDetails?.trim() ?? "";

  const payload: Record<string, unknown> = {
    organizationId: input.organizationId,
    hostId: primaryHostId,
    hostName,
    internalHostIds,
    bookedById: input.actorUid,
    bookedByName: input.actorName ?? "",
    leadId: input.leadId ?? "",
    leadOwnerId: input.leadOwnerId ?? "",
    contactId: input.contactId ?? "",
    schedulingLinkId: input.schedulingLinkId ?? "",
    title: input.title.trim(),
    startAt: Timestamp.fromDate(new Date(input.startAt)),
    endAt: Timestamp.fromDate(new Date(input.endAt)),
    timezone: input.timezone || DEFAULT_TIMEZONE,
    status: "scheduled",
    attendeeName: input.attendeeName.trim(),
    attendeeEmail: input.attendeeEmail.trim().toLowerCase(),
    attendeeNotes: input.attendeeNotes?.trim() ?? "",
    guestEmails: input.guestEmails ?? [],
    locationType,
    locationDetails,
    source: input.source,
    inboundInviteUid: input.inboundInviteUid ?? "",
    organizerEmail: input.organizerEmail?.trim().toLowerCase() ?? "",
    googleEventIdsByHost: {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  let googleEventIdsByHost: Record<string, string> = {};
  let googleErrors: { hostId: string; error: string; needsReconnect?: boolean }[] = [];

  if (input.writeGoogle !== false) {
    const placed = await insertGoogleEventsForHostsServer({
      organizationId: input.organizationId,
      hostIds,
      primaryHostId,
      summary: input.title.trim(),
      description: input.attendeeNotes?.trim(),
      location: locationLabel(locationType, locationDetails),
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone || DEFAULT_TIMEZONE,
      clientAttendeeEmail: input.attendeeEmail.trim().toLowerCase(),
      sendClientInviteOnPrimary: Boolean(input.sendClientGoogleInvite),
    });
    googleEventIdsByHost = placed.googleEventIdsByHost;
    googleErrors = placed.errors;
    payload.googleEventIdsByHost = googleEventIdsByHost;
  }

  const ref = await db.collection(COLLECTIONS.meetings).add(payload);
  const fresh = await ref.get();
  const meeting = meetingFromFirestoreDoc(ref.id, fresh.data()!);

  if (meeting.leadId) {
    const summary =
      meeting.bookedById && meeting.bookedById !== meeting.hostId
        ? `Meeting scheduled on ${meeting.hostName ?? "host"}'s calendar`
        : `Meeting scheduled: ${meeting.title}`;
    await db.collection(COLLECTIONS.timelineEvents).add({
      organizationId: meeting.organizationId,
      leadId: meeting.leadId,
      leadOwnerId: meeting.leadOwnerId ?? meeting.hostId,
      type: "meeting_scheduled",
      actorId: input.actorUid,
      summary,
      payload: {
        meetingId: meeting.id,
        hostId: meeting.hostId,
        bookedById: meeting.bookedById,
        startAt: meeting.startAt,
        attendeeEmail: meeting.attendeeEmail,
        source: meeting.source,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { meeting, googleEventIdsByHost, googleErrors };
}

export async function patchMeetingGoogleEventIdsServer(input: {
  meetingId: string;
  googleEventIdsByHost: Record<string, string>;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  await db.collection(COLLECTIONS.meetings).doc(input.meetingId).update({
    googleEventIdsByHost: input.googleEventIdsByHost,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
