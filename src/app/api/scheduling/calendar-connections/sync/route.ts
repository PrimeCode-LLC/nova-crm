import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveCalendarHostAccessServer } from "@/lib/scheduling/calendar-delegation-server";
import { syncHostCalendarServer } from "@/lib/scheduling/google-calendar-events-server";

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let hostId = g.ctx.session.uid;
  try {
    const json = (await req.json()) as { hostId?: string };
    if (json.hostId?.trim()) hostId = json.hostId.trim();
  } catch {
    // default to current user
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

  const result = await syncHostCalendarServer({
    organizationId: g.ctx.session.organizationId,
    hostUid: hostId,
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      needsReconnect: result.needsReconnect,
      error: result.error,
      connectionCount: result.connectionCount,
    });
  }

  return NextResponse.json({
    ok: true,
    eventCount: result.eventCount,
    needsReconnect: result.needsReconnect,
    lastSyncAt: result.lastSyncAt,
    connectionCount: result.connectionCount,
  });
}
