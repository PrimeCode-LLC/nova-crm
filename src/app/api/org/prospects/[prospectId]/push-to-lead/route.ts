import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { pushProspectChannelToLeadServer } from "@/lib/prospects/push-to-lead-server";

const bodySchema = z.object({
  assignmentId: z.string().min(1),
});

type RouteCtx = { params: Promise<{ prospectId: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { prospectId } = await ctx.params;

  let json: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await pushProspectChannelToLeadServer({
    organizationId: g.ctx.session.organizationId,
    prospectId,
    assignmentId: parsed.data.assignmentId,
    userId: g.ctx.session.uid,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
