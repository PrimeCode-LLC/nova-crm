import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { updateMeetingStatusServer } from "@/lib/scheduling/scheduling-server";

const patchSchema = z.object({
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
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
  const r = await updateMeetingStatusServer({
    organizationId: g.ctx.session.organizationId,
    meetingId: id,
    actorUid: g.ctx.session.uid,
    status: parsed.data.status,
  });
  if ("error" in r) {
    const status = r.error === "Forbidden" ? 403 : 400;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({ ok: true, item: r.meeting });
}
