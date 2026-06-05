import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveCalendarHostAccessServer } from "@/lib/scheduling/calendar-delegation-server";
import { listExternalCalendarEventsServer } from "@/lib/scheduling/google-calendar-events-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const hostId = url.searchParams.get("hostId")?.trim() || g.ctx.session.uid;
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();

  if (!from || !to) {
    return NextResponse.json(
      { ok: false, error: "from and to query params required (ISO dates)" },
      { status: 400 },
    );
  }

  const access = await resolveCalendarHostAccessServer({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    hostId,
    action: "view_availability",
  });
  if (!access.allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { events, needsReconnect } = await listExternalCalendarEventsServer({
    organizationId: g.ctx.session.organizationId,
    hostUid: hostId,
    from,
    to,
  });

  return NextResponse.json({
    ok: true,
    items: events,
    needsReconnect,
    eventCount: events.length,
  });
}
