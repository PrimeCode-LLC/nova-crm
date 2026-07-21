import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { slugifyOrganizationName } from "@/lib/platform/slug";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { sendSystemEmail } from "@/lib/email/send-system-email";
import {
  datesWithAvailability,
  generateSlotsForDate,
  type BookableSlot,
} from "@/lib/scheduling/availability-slots";
import { renderMeetingConfirmationEmail } from "@/lib/scheduling/meeting-email";
import { buildMeetingIcs } from "@/lib/scheduling/ics";
import { insertGoogleEventsForHostsServer } from "@/lib/scheduling/google-calendar-events-server";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKLY_AVAILABILITY,
  WEEKDAY_KEYS,
} from "@/lib/scheduling/defaults";
import {
  resolveCalendarHostAccessServer,
} from "@/lib/scheduling/calendar-delegation-server";
import type {
  AvailabilitySchedule,
  CalendarDelegatePermission,
  Meeting,
  MeetingLocationType,
  MeetingSource,
  MeetingStatus,
  SchedulingLink,
  SchedulingLinkType,
  WeeklyAvailability,
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

const LINK_TYPES: SchedulingLinkType[] = ["personal", "team", "event"];

function parseWeekly(raw: unknown): WeeklyAvailability {
  const base = { ...DEFAULT_WEEKLY_AVAILABILITY };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const key of WEEKDAY_KEYS) {
    if (!Array.isArray(o[key])) continue;
    base[key] = o[key]
      .map((slot: unknown) => {
        if (!slot || typeof slot !== "object") return null;
        const s = slot as Record<string, unknown>;
        const start = String(s.start ?? "").trim();
        const end = String(s.end ?? "").trim();
        if (!start || !end) return null;
        return { start, end };
      })
      .filter(Boolean) as WeeklyAvailability[typeof key];
  }
  return base;
}

function docToSchedule(id: string, data: DocumentData): AvailabilitySchedule {
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    name: String(data.name ?? "Working hours"),
    isDefault: Boolean(data.isDefault),
    timezone: String(data.timezone ?? DEFAULT_TIMEZONE),
    weekly: parseWeekly(data.weekly),
    minNoticeHours: Number(data.minNoticeHours ?? 4),
    maxDaysAhead: Number(data.maxDaysAhead ?? 60),
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

function docToLink(id: string, data: DocumentData): SchedulingLink {
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    slug: String(data.slug ?? id),
    hostId: String(data.hostId ?? ""),
    hostName: typeof data.hostName === "string" ? data.hostName : undefined,
    title: String(data.title ?? "Meeting"),
    description: typeof data.description === "string" ? data.description : undefined,
    durationMin: Number(data.durationMin ?? 30),
    bufferBeforeMin: Number(data.bufferBeforeMin ?? 0),
    bufferAfterMin: Number(data.bufferAfterMin ?? 0),
    locationType: LOCATION_TYPES.includes(data.locationType as MeetingLocationType)
      ? (data.locationType as MeetingLocationType)
      : "google_meet",
    locationDetails: typeof data.locationDetails === "string" ? data.locationDetails : undefined,
    linkType: LINK_TYPES.includes(data.linkType as SchedulingLinkType)
      ? (data.linkType as SchedulingLinkType)
      : "event",
    color: typeof data.color === "string" ? data.color : undefined,
    active: data.active !== false,
    scheduleId: typeof data.scheduleId === "string" ? data.scheduleId : undefined,
    roundRobinHostIds: Array.isArray(data.roundRobinHostIds)
      ? data.roundRobinHostIds.map((x: unknown) => String(x)).filter(Boolean)
      : undefined,
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

function docToMeeting(id: string, data: DocumentData): Meeting {
  const statuses: MeetingStatus[] = ["scheduled", "completed", "cancelled", "no_show"];
  const sources: MeetingSource[] = [
    "public_link",
    "internal",
    "manual",
    "invite_rsvp",
    "email_thread",
    "external_booking",
  ];
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
    source: sources.includes(data.source as MeetingSource)
      ? (data.source as MeetingSource)
      : "manual",
    inboundInviteUid:
      typeof data.inboundInviteUid === "string" && data.inboundInviteUid
        ? data.inboundInviteUid
        : undefined,
    organizerEmail:
      typeof data.organizerEmail === "string" && data.organizerEmail
        ? data.organizerEmail
        : undefined,
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

async function uniqueLinkSlug(
  organizationId: string,
  title: string,
  excludeId?: string,
): Promise<string> {
  const db = getAdminDb();
  let base = slugifyOrganizationName(title).toLowerCase() || "meeting";
  base = base.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || "meeting";
  if (!db) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const snap = await db
      .collection(COLLECTIONS.schedulingLinks)
      .where("organizationId", "==", organizationId)
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty || (excludeId && snap.docs[0]?.id === excludeId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function getOrganizationBySlugServer(slug: string) {
  const db = getAdminDb();
  if (!db) return null;
  const normalized = slug.trim().toLowerCase();
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .where("slug", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, name: String(d.data().name ?? ""), slug: normalized };
}

export async function getDefaultScheduleForHostServer(input: {
  organizationId: string;
  hostId: string;
}): Promise<AvailabilitySchedule> {
  const db = getAdminDb();
  if (!db) {
    return {
      id: "default",
      organizationId: input.organizationId,
      ownerUid: input.hostId,
      name: "Working hours (default)",
      isDefault: true,
      timezone: DEFAULT_TIMEZONE,
      weekly: DEFAULT_WEEKLY_AVAILABILITY,
      minNoticeHours: 4,
      maxDaysAhead: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  const snap = await db
    .collection(COLLECTIONS.availabilitySchedules)
    .where("organizationId", "==", input.organizationId)
    .where("ownerUid", "==", input.hostId)
    .where("isDefault", "==", true)
    .limit(1)
    .get();
  if (!snap.empty) {
    return docToSchedule(snap.docs[0]!.id, snap.docs[0]!.data());
  }
  const payload = {
    organizationId: input.organizationId,
    ownerUid: input.hostId,
    name: "Working hours (default)",
    isDefault: true,
    timezone: DEFAULT_TIMEZONE,
    weekly: DEFAULT_WEEKLY_AVAILABILITY,
    minNoticeHours: 4,
    maxDaysAhead: 60,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTIONS.availabilitySchedules).add(payload);
  const fresh = await ref.get();
  return docToSchedule(ref.id, fresh.data()!);
}

export async function updateScheduleServer(input: {
  organizationId: string;
  ownerUid: string;
  scheduleId: string;
  name?: string;
  timezone?: string;
  weekly?: WeeklyAvailability;
  minNoticeHours?: number;
  maxDaysAhead?: number;
}): Promise<{ schedule: AvailabilitySchedule } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.availabilitySchedules).doc(input.scheduleId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Schedule not found" };
  const data = snap.data()!;
  if (
    String(data.organizationId) !== input.organizationId ||
    String(data.ownerUid) !== input.ownerUid
  ) {
    return { error: "Schedule not found" };
  }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.timezone !== undefined) patch.timezone = input.timezone.trim();
  if (input.weekly !== undefined) patch.weekly = input.weekly;
  if (input.minNoticeHours !== undefined) patch.minNoticeHours = input.minNoticeHours;
  if (input.maxDaysAhead !== undefined) patch.maxDaysAhead = input.maxDaysAhead;
  await ref.update(patch);
  const fresh = await ref.get();
  return { schedule: docToSchedule(ref.id, fresh.data()!) };
}

export async function listSchedulingLinksServer(input: {
  organizationId: string;
  viewerUid: string;
  hostId?: string;
}): Promise<SchedulingLink[]> {
  const db = getAdminDb();
  if (!db) return [];
  let q = db
    .collection(COLLECTIONS.schedulingLinks)
    .where("organizationId", "==", input.organizationId);
  if (input.hostId) {
    q = q.where("hostId", "==", input.hostId);
  }
  const snap = await q.get();
  const items = snap.docs.map((d) => docToLink(d.id, d.data()));
  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

export async function getSchedulingLinkBySlugServer(input: {
  organizationId: string;
  slug: string;
}): Promise<SchedulingLink | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db
    .collection(COLLECTIONS.schedulingLinks)
    .where("organizationId", "==", input.organizationId)
    .where("slug", "==", input.slug.trim().toLowerCase())
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return docToLink(snap.docs[0]!.id, snap.docs[0]!.data());
}

export async function createSchedulingLinkServer(input: {
  organizationId: string;
  hostId: string;
  hostName?: string;
  title: string;
  description?: string;
  durationMin?: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  locationType?: MeetingLocationType;
  locationDetails?: string;
  linkType?: SchedulingLinkType;
  color?: string;
  slug?: string;
}): Promise<{ link: SchedulingLink } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const title = input.title.trim();
  if (!title) return { error: "Title is required" };
  const slug = (input.slug?.trim().toLowerCase() ||
    (await uniqueLinkSlug(input.organizationId, title)));
  const schedule = await getDefaultScheduleForHostServer({
    organizationId: input.organizationId,
    hostId: input.hostId,
  });
  const payload = {
    organizationId: input.organizationId,
    slug,
    hostId: input.hostId,
    hostName: input.hostName ?? "",
    title,
    description: input.description?.trim() ?? "",
    durationMin: input.durationMin ?? 30,
    bufferBeforeMin: input.bufferBeforeMin ?? 0,
    bufferAfterMin: input.bufferAfterMin ?? 15,
    locationType: input.locationType ?? "google_meet",
    locationDetails: input.locationDetails?.trim() ?? "",
    linkType: input.linkType ?? "event",
    color: input.color ?? "#6366f1",
    active: true,
    scheduleId: schedule.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTIONS.schedulingLinks).add(payload);
  const fresh = await ref.get();
  return { link: docToLink(ref.id, fresh.data()!) };
}

export async function updateSchedulingLinkServer(input: {
  organizationId: string;
  id: string;
  actorUid: string;
  patch: Partial<
    Pick<
      SchedulingLink,
      | "title"
      | "description"
      | "durationMin"
      | "bufferBeforeMin"
      | "bufferAfterMin"
      | "locationType"
      | "locationDetails"
      | "color"
      | "active"
      | "scheduleId"
    >
  >;
}): Promise<{ link: SchedulingLink } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.schedulingLinks).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Link not found" };
  const existing = docToLink(ref.id, snap.data()!);
  if (existing.organizationId !== input.organizationId) return { error: "Link not found" };

  const access = await resolveCalendarHostAccessServer({
    organizationId: input.organizationId,
    viewerUid: input.actorUid,
    hostId: existing.hostId,
    action: "manage_links",
    schedulingLinkId: existing.id,
  });
  if (!access.allowed) return { error: "Forbidden" };

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(input.patch)) {
    if (v !== undefined) patch[k] = v;
  }
  await ref.update(patch);
  const fresh = await ref.get();
  return { link: docToLink(ref.id, fresh.data()!) };
}

export async function deleteSchedulingLinkServer(input: {
  organizationId: string;
  id: string;
  actorUid: string;
}): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.schedulingLinks).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Link not found" };
  const existing = docToLink(ref.id, snap.data()!);
  if (existing.organizationId !== input.organizationId) return { error: "Link not found" };
  const access = await resolveCalendarHostAccessServer({
    organizationId: input.organizationId,
    viewerUid: input.actorUid,
    hostId: existing.hostId,
    action: "manage_links",
    schedulingLinkId: existing.id,
  });
  if (!access.allowed) return { error: "Forbidden" };
  await ref.delete();
  return { ok: true };
}

async function listMeetingsForHostServer(
  organizationId: string,
  hostId: string,
  from?: string,
  to?: string,
): Promise<Meeting[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.meetings)
    .where("organizationId", "==", organizationId)
    .where("hostId", "==", hostId)
    .get();
  let items = snap.docs.map((d) => docToMeeting(d.id, d.data()));
  if (from) {
    const f = new Date(from).getTime();
    items = items.filter((m) => new Date(m.endAt).getTime() >= f);
  }
  if (to) {
    const t = new Date(to).getTime();
    items = items.filter((m) => new Date(m.startAt).getTime() <= t);
  }
  items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return items;
}

export async function listMeetingsServer(input: {
  organizationId: string;
  viewerUid: string;
  hostId?: string;
  leadId?: string;
  from?: string;
  to?: string;
  /** Org-wide list for managers/owners (dashboard ops board). */
  scope?: "host" | "org";
}): Promise<Meeting[]> {
  const db = getAdminDb();
  if (!db) return [];

  if (input.leadId) {
    const snap = await db
      .collection(COLLECTIONS.meetings)
      .where("organizationId", "==", input.organizationId)
      .where("leadId", "==", input.leadId)
      .get();
    return snap.docs
      .map((d) => docToMeeting(d.id, d.data()))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }

  if (input.scope === "org") {
    const snap = await db
      .collection(COLLECTIONS.meetings)
      .where("organizationId", "==", input.organizationId)
      .get();
    let items = snap.docs.map((d) => docToMeeting(d.id, d.data()));
    if (input.from) {
      const f = new Date(input.from).getTime();
      items = items.filter((m) => new Date(m.endAt).getTime() >= f);
    }
    if (input.to) {
      const t = new Date(input.to).getTime();
      items = items.filter((m) => new Date(m.startAt).getTime() <= t);
    }
    items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return items;
  }

  const hostId = input.hostId ?? input.viewerUid;
  return listMeetingsForHostServer(
    input.organizationId,
    hostId,
    input.from,
    input.to,
  );
}

export async function getPublicLinkContextServer(input: {
  orgSlug: string;
  linkSlug: string;
}): Promise<
  | {
      organization: { id: string; name: string; slug: string };
      link: SchedulingLink;
      schedule: AvailabilitySchedule;
      availableDates: string[];
    }
  | { error: string }
> {
  const org = await getOrganizationBySlugServer(input.orgSlug);
  if (!org) return { error: "Organization not found" };
  const link = await getSchedulingLinkBySlugServer({
    organizationId: org.id,
    slug: input.linkSlug,
  });
  if (!link) return { error: "Scheduling link not found" };

  const schedule = link.scheduleId
    ? await (async () => {
        const db = getAdminDb();
        if (!db) return getDefaultScheduleForHostServer({ organizationId: org.id, hostId: link.hostId });
        const s = await db.collection(COLLECTIONS.availabilitySchedules).doc(link.scheduleId!).get();
        if (!s.exists) {
          return getDefaultScheduleForHostServer({ organizationId: org.id, hostId: link.hostId });
        }
        return docToSchedule(s.id, s.data()!);
      })()
    : await getDefaultScheduleForHostServer({ organizationId: org.id, hostId: link.hostId });

  const existing = await listMeetingsForHostServer(org.id, link.hostId);
  const availableDates = datesWithAvailability({
    schedule,
    durationMin: link.durationMin,
    bufferBeforeMin: link.bufferBeforeMin,
    bufferAfterMin: link.bufferAfterMin,
    existingMeetings: existing,
  });

  return { organization: org, link, schedule, availableDates };
}

export async function getSlotsForPublicLinkServer(input: {
  orgSlug: string;
  linkSlug: string;
  dateYmd: string;
}): Promise<{ slots: BookableSlot[] } | { error: string }> {
  const ctx = await getPublicLinkContextServer({
    orgSlug: input.orgSlug,
    linkSlug: input.linkSlug,
  });
  if ("error" in ctx) return ctx;
  const day = new Date(`${input.dateYmd}T12:00:00`);
  if (Number.isNaN(day.getTime())) return { error: "Invalid date" };
  const existing = await listMeetingsForHostServer(
    ctx.organization.id,
    ctx.link.hostId,
  );
  const slots = generateSlotsForDate({
    date: day,
    schedule: ctx.schedule,
    durationMin: ctx.link.durationMin,
    bufferBeforeMin: ctx.link.bufferBeforeMin,
    bufferAfterMin: ctx.link.bufferAfterMin,
    existingMeetings: existing,
  });
  return { slots };
}

async function createTimelineForMeeting(
  meeting: Meeting,
  actorId?: string,
): Promise<void> {
  if (!meeting.leadId) return;
  const db = getAdminDb();
  if (!db) return;
  const summary =
    meeting.bookedById && meeting.bookedById !== meeting.hostId
      ? `Meeting scheduled on ${meeting.hostName ?? "host"}'s calendar`
      : `Meeting scheduled: ${meeting.title}`;
  const leadOwnerId = meeting.leadOwnerId ?? meeting.hostId;
  const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
  await db.collection(COLLECTIONS.timelineEvents).add({
    organizationId: meeting.organizationId,
    leadId: meeting.leadId,
    leadOwnerId,
    leadOwnerManagerIds,
    type: "meeting_scheduled",
    actorId: actorId ?? meeting.bookedById ?? meeting.hostId,
    summary,
    payload: {
      meetingId: meeting.id,
      hostId: meeting.hostId,
      bookedById: meeting.bookedById,
      startAt: meeting.startAt,
      attendeeEmail: meeting.attendeeEmail,
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function bookMeetingServer(input: {
  organizationId: string;
  hostId: string;
  /** Extra internal hosts to receive a Google Calendar copy (delegation required). */
  internalHostIds?: string[];
  schedulingLinkId?: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
  guestEmails?: string[];
  locationType: MeetingLocationType;
  locationDetails?: string;
  source: MeetingSource;
  bookedById?: string;
  bookedByName?: string;
  leadId?: string;
  leadOwnerId?: string;
  contactId?: string;
  actorUid?: string;
  skipAccessCheck?: boolean;
  /** When true, invite the client on the primary host Google event. */
  sendClientGoogleInvite?: boolean;
  /** Organizer email for ICS (defaults to host email). */
  organizerEmail?: string;
}): Promise<{ meeting: Meeting; googleErrors?: { hostId: string; error: string }[] } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const hostIds = [
    input.hostId,
    ...(input.internalHostIds ?? []).filter((id) => id && id !== input.hostId),
  ];

  if (!input.skipAccessCheck && input.actorUid) {
    for (const hostId of hostIds) {
      const access = await resolveCalendarHostAccessServer({
        organizationId: input.organizationId,
        viewerUid: input.actorUid,
        hostId,
        action: "book",
        schedulingLinkId: input.schedulingLinkId,
      });
      if (!access.allowed) return { error: "You cannot book on this calendar" };
    }
  }

  const orgUsers = await listOrgUsersServer(input.organizationId);
  const host = orgUsers.find((u) => u.id === input.hostId);
  const hostName = host?.displayName?.trim() || host?.email?.split("@")[0] || input.hostId;
  const organizerEmail =
    input.organizerEmail?.trim().toLowerCase() ||
    host?.email?.trim().toLowerCase() ||
    "";

  const locationLabel =
    input.locationDetails?.trim() ||
    (input.locationType === "google_meet"
      ? "Google Meet"
      : input.locationType === "zoom"
        ? "Zoom"
        : input.locationType === "teams"
          ? "Microsoft Teams"
          : input.locationType === "phone"
            ? "Phone call"
            : "Meeting");

  const googlePlaced = await insertGoogleEventsForHostsServer({
    organizationId: input.organizationId,
    hostIds,
    primaryHostId: input.hostId,
    summary: input.title.trim(),
    description: input.attendeeNotes?.trim(),
    location: locationLabel,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    clientAttendeeEmail: input.attendeeEmail.trim().toLowerCase(),
    sendClientInviteOnPrimary: input.sendClientGoogleInvite !== false,
  });

  const payload = {
    organizationId: input.organizationId,
    hostId: input.hostId,
    hostName,
    internalHostIds: hostIds.slice(1),
    googleEventIdsByHost: googlePlaced.googleEventIdsByHost,
    bookedById: input.bookedById ?? "",
    bookedByName: input.bookedByName ?? "",
    leadId: input.leadId ?? "",
    leadOwnerId: input.leadOwnerId ?? "",
    contactId: input.contactId ?? "",
    schedulingLinkId: input.schedulingLinkId ?? "",
    title: input.title.trim(),
    startAt: Timestamp.fromDate(new Date(input.startAt)),
    endAt: Timestamp.fromDate(new Date(input.endAt)),
    timezone: input.timezone,
    status: "scheduled",
    attendeeName: input.attendeeName.trim(),
    attendeeEmail: input.attendeeEmail.trim().toLowerCase(),
    attendeeNotes: input.attendeeNotes?.trim() ?? "",
    guestEmails: input.guestEmails ?? [],
    locationType: input.locationType,
    locationDetails: input.locationDetails?.trim() ?? "",
    source: input.source,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ref = await db.collection(COLLECTIONS.meetings).add(payload);
  const fresh = await ref.get();
  const meeting = docToMeeting(ref.id, fresh.data()!);

  await createTimelineForMeeting(meeting, input.actorUid);

  const org = await getOrganizationServer(input.organizationId);
  if (org) {
    const email = renderMeetingConfirmationEmail({
      meeting,
      organization: org,
      hostDisplayName: hostName,
    });
    const ics =
      organizerEmail
        ? buildMeetingIcs(meeting, organizerEmail)
        : null;
    await sendSystemEmail({
      to: meeting.attendeeEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: ics
        ? [
            {
              filename: "invite.ics",
              contentType: "text/calendar; method=REQUEST",
              content: Buffer.from(ics, "utf8"),
            },
          ]
        : undefined,
    }).catch(() => undefined);
  }

  return {
    meeting,
    googleErrors: googlePlaced.errors.length ? googlePlaced.errors : undefined,
  };
}

export async function updateMeetingStatusServer(input: {
  organizationId: string;
  meetingId: string;
  actorUid: string;
  status: MeetingStatus;
}): Promise<{ meeting: Meeting } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.meetings).doc(input.meetingId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Meeting not found" };
  const existing = docToMeeting(ref.id, snap.data()!);
  if (existing.organizationId !== input.organizationId) return { error: "Meeting not found" };

  const access = await resolveCalendarHostAccessServer({
    organizationId: input.organizationId,
    viewerUid: input.actorUid,
    hostId: existing.hostId,
    action: input.status === "cancelled" ? "cancel" : "book",
  });
  if (!access.allowed && existing.bookedById !== input.actorUid) {
    return { error: "Forbidden" };
  }

  await ref.update({
    status: input.status,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const fresh = await ref.get();
  const meeting = docToMeeting(ref.id, fresh.data()!);

  if (meeting.leadId && (input.status === "completed" || input.status === "cancelled")) {
    const type = input.status === "completed" ? "meeting_completed" : "meeting_cancelled";
    const leadOwnerId = meeting.leadOwnerId ?? meeting.hostId;
    const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
    await db.collection(COLLECTIONS.timelineEvents).add({
      organizationId: input.organizationId,
      leadId: meeting.leadId,
      leadOwnerId,
      leadOwnerManagerIds,
      type,
      actorId: input.actorUid,
      summary:
        input.status === "completed"
          ? `Meeting completed: ${meeting.title}`
          : `Meeting cancelled: ${meeting.title}`,
      payload: { meetingId: meeting.id },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { meeting };
}

export async function getScheduleForViewerServer(input: {
  organizationId: string;
  viewerUid: string;
  hostId?: string;
}): Promise<AvailabilitySchedule> {
  const hostId = input.hostId ?? input.viewerUid;
  return getDefaultScheduleForHostServer({
    organizationId: input.organizationId,
    hostId,
  });
}

export type { BookableSlot };
