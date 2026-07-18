import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { placeMeetingServer } from "@/lib/scheduling/place-meeting-server";
import { buildMeetingIcs } from "@/lib/scheduling/ics";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/defaults";

const schema = z.object({
  hostIds: z.array(z.string().min(1)).min(1).max(20),
  title: z.string().min(1).max(200),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  timezone: z.string().min(1).max(80).default(DEFAULT_TIMEZONE),
  attendeeName: z.string().min(1).max(120),
  attendeeEmail: z.string().email(),
  attendeeNotes: z.string().max(5000).optional(),
  locationType: z
    .enum(["google_meet", "zoom", "teams", "phone", "in_person", "custom"])
    .default("google_meet"),
  locationDetails: z.string().max(500).optional(),
  source: z.enum(["email_thread", "external_booking", "internal"]).default("email_thread"),
  leadId: z.string().optional(),
  leadOwnerId: z.string().optional(),
  contactId: z.string().optional(),
  sendClientGoogleInvite: z.boolean().optional(),
  /** When true, include METHOD:REQUEST ICS for mailbox send. */
  includeIcs: z.boolean().optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  const hostIds = parsed.data.hostIds;
  const primaryHostId = hostIds[0]!;

  const placed = await placeMeetingServer({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    actorName: g.ctx.session.name,
    hostIds,
    title: parsed.data.title,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    timezone: parsed.data.timezone,
    attendeeName: parsed.data.attendeeName,
    attendeeEmail: parsed.data.attendeeEmail,
    attendeeNotes: parsed.data.attendeeNotes,
    locationType: parsed.data.locationType,
    locationDetails: parsed.data.locationDetails,
    source: parsed.data.source,
    leadId: parsed.data.leadId,
    leadOwnerId: parsed.data.leadOwnerId ?? g.ctx.session.uid,
    contactId: parsed.data.contactId,
    sendClientGoogleInvite: parsed.data.sendClientGoogleInvite !== false,
    writeGoogle: true,
  });

  if ("error" in placed) {
    const status = placed.error.includes("cannot book") ? 403 : 400;
    return NextResponse.json({ ok: false, error: placed.error }, { status });
  }

  let inviteIcs: string | undefined;
  let organizerEmail: string | undefined;
  if (parsed.data.includeIcs !== false) {
    const orgUsers = await listOrgUsersServer(g.ctx.session.organizationId);
    const host = orgUsers.find((u) => u.id === primaryHostId);
    organizerEmail =
      host?.email?.trim().toLowerCase() ||
      g.ctx.session.email?.trim().toLowerCase() ||
      undefined;
    if (organizerEmail) {
      inviteIcs = buildMeetingIcs(placed.meeting, organizerEmail);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      meeting: placed.meeting,
      googleErrors: placed.googleErrors,
      inviteIcs,
      organizerEmail,
    },
    { status: 201 },
  );
}
