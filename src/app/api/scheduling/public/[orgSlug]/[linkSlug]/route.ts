import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSlotsForDate } from "@/lib/scheduling/availability-slots";
import {
  demoAvailabilitySchedule,
  demoMeetings,
  DEMO_ORG_SLUG,
} from "@/lib/demo-scheduling";
import {
  bookMeetingServer,
  getPublicLinkContextServer,
  getSlotsForPublicLinkServer,
} from "@/lib/scheduling/scheduling-server";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ orgSlug: string; linkSlug: string }> },
) {
  const { orgSlug, linkSlug } = await ctx.params;
  const date = new URL(req.url).searchParams.get("date")?.trim();
  if (date) {
    const slots = await getSlotsForPublicLinkServer({ orgSlug, linkSlug, dateYmd: date });
    if ("error" in slots) {
      if (orgSlug === DEMO_ORG_SLUG) {
        const schedule = demoAvailabilitySchedule("demo-host");
        const day = new Date(`${date}T12:00:00`);
        const demoSlots = generateSlotsForDate({
          date: day,
          schedule,
          durationMin: 15,
          bufferBeforeMin: 0,
          bufferAfterMin: 15,
          existingMeetings: demoMeetings([]),
        });
        return NextResponse.json({ ok: true, slots: demoSlots });
      }
      return NextResponse.json({ ok: false, error: slots.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true, slots: slots.slots });
  }
  const data = await getPublicLinkContextServer({ orgSlug, linkSlug });
  if ("error" in data) {
    return NextResponse.json({ ok: false, error: data.error }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    organization: data.organization,
    link: {
      id: data.link.id,
      slug: data.link.slug,
      title: data.link.title,
      description: data.link.description,
      durationMin: data.link.durationMin,
      locationType: data.link.locationType,
      locationDetails: data.link.locationDetails,
      hostName: data.link.hostName,
      color: data.link.color,
    },
    schedule: { timezone: data.schedule.timezone },
    availableDates: data.availableDates,
  });
}

const bookSchema = z.object({
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  attendeeName: z.string().min(1).max(120),
  attendeeEmail: z.string().email(),
  attendeeNotes: z.string().max(5000).optional(),
  guestEmails: z.array(z.string().email()).max(10).optional(),
  timezone: z.string().max(80).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ orgSlug: string; linkSlug: string }> },
) {
  const { orgSlug, linkSlug } = await ctx.params;
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
  const ctxData = await getPublicLinkContextServer({ orgSlug, linkSlug });
  if ("error" in ctxData) {
    return NextResponse.json({ ok: false, error: ctxData.error }, { status: 404 });
  }
  const { link, organization } = ctxData;
  const r = await bookMeetingServer({
    organizationId: organization.id,
    hostId: link.hostId,
    schedulingLinkId: link.id,
    title: link.title,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    timezone: parsed.data.timezone ?? ctxData.schedule.timezone,
    attendeeName: parsed.data.attendeeName,
    attendeeEmail: parsed.data.attendeeEmail,
    attendeeNotes: parsed.data.attendeeNotes,
    guestEmails: parsed.data.guestEmails,
    locationType: link.locationType,
    locationDetails: link.locationDetails,
    source: "public_link",
    skipAccessCheck: true,
  });
  if ("error" in r) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, meeting: r.meeting }, { status: 201 });
}
