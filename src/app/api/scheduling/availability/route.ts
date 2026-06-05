import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  getScheduleForViewerServer,
  listMeetingsServer,
  updateScheduleServer,
} from "@/lib/scheduling/scheduling-server";
import { generateSlotsForDate } from "@/lib/scheduling/availability-slots";
import { resolveCalendarHostAccessServer } from "@/lib/scheduling/calendar-delegation-server";

const patchSchema = z.object({
  scheduleId: z.string().min(1),
  hostId: z.string().optional(),
  name: z.string().max(120).optional(),
  timezone: z.string().max(80).optional(),
  minNoticeHours: z.number().int().min(0).max(168).optional(),
  maxDaysAhead: z.number().int().min(1).max(365).optional(),
  weekly: z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() }))).optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const hostId = url.searchParams.get("hostId")?.trim() || g.ctx.session.uid;
  const dateYmd = url.searchParams.get("date")?.trim();
  const durationMin = Number(url.searchParams.get("durationMin") ?? 30);
  const bufferBefore = Number(url.searchParams.get("bufferBefore") ?? 0);
  const bufferAfter = Number(url.searchParams.get("bufferAfter") ?? 15);

  const access = await resolveCalendarHostAccessServer({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    hostId,
    action: "view_availability",
  });
  if (!access.allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const schedule = await getScheduleForViewerServer({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    hostId,
  });

  if (!dateYmd) {
    return NextResponse.json({ ok: true, schedule });
  }

  const meetings = await listMeetingsServer({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    hostId,
  });
  const day = new Date(`${dateYmd}T12:00:00`);
  const slots = generateSlotsForDate({
    date: day,
    schedule,
    durationMin,
    bufferBeforeMin: bufferBefore,
    bufferAfterMin: bufferAfter,
    existingMeetings: meetings,
  });
  return NextResponse.json({ ok: true, schedule, slots });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }
  const ownerUid = parsed.data.hostId?.trim() || g.ctx.session.uid;
  if (ownerUid !== g.ctx.session.uid) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const r = await updateScheduleServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid,
    scheduleId: parsed.data.scheduleId,
    name: parsed.data.name,
    timezone: parsed.data.timezone,
    weekly: parsed.data.weekly as import("@/lib/types").WeeklyAvailability | undefined,
    minNoticeHours: parsed.data.minNoticeHours,
    maxDaysAhead: parsed.data.maxDaysAhead,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, schedule: r.schedule });
}
