import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  bookMeetingServer,
  listMeetingsServer,
} from "@/lib/scheduling/scheduling-server";
const bookSchema = z.object({
  hostId: z.string().min(1),
  internalHostIds: z.array(z.string().min(1)).max(20).optional(),
  schedulingLinkId: z.string().optional(),
  title: z.string().min(1).max(200),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  timezone: z.string().min(1).max(80),
  attendeeName: z.string().min(1).max(120),
  attendeeEmail: z.string().email(),
  attendeeNotes: z.string().max(5000).optional(),
  guestEmails: z.array(z.string().email()).max(10).optional(),
  locationType: z
    .enum(["google_meet", "zoom", "teams", "phone", "in_person", "custom"])
    .default("google_meet"),
  locationDetails: z.string().max(500).optional(),
  leadId: z.string().optional(),
  leadOwnerId: z.string().optional(),
  contactId: z.string().optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const hostId = url.searchParams.get("hostId")?.trim() || undefined;
  const leadId = url.searchParams.get("leadId")?.trim() || undefined;
  const from = url.searchParams.get("from")?.trim() || undefined;
  const to = url.searchParams.get("to")?.trim() || undefined;
  const items = await listMeetingsServer({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    hostId,
    leadId,
    from,
    to,
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bookSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }
  const r = await bookMeetingServer({
    organizationId: g.ctx.session.organizationId,
    hostId: parsed.data.hostId,
    internalHostIds: parsed.data.internalHostIds,
    schedulingLinkId: parsed.data.schedulingLinkId,
    title: parsed.data.title,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    timezone: parsed.data.timezone,
    attendeeName: parsed.data.attendeeName,
    attendeeEmail: parsed.data.attendeeEmail,
    attendeeNotes: parsed.data.attendeeNotes,
    guestEmails: parsed.data.guestEmails,
    locationType: parsed.data.locationType,
    locationDetails: parsed.data.locationDetails,
    source: "internal",
    bookedById: g.ctx.session.uid,
    bookedByName: g.ctx.session.name,
    leadId: parsed.data.leadId,
    leadOwnerId: parsed.data.leadOwnerId ?? g.ctx.session.uid,
    contactId: parsed.data.contactId,
    actorUid: g.ctx.session.uid,
    sendClientGoogleInvite: true,
  });
  if ("error" in r) {
    const status = r.error.includes("cannot book") ? 403 : 400;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json(
    { ok: true, item: r.meeting, googleErrors: r.googleErrors },
    { status: 201 },
  );
}
