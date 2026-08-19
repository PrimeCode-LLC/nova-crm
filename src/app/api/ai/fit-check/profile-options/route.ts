import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/ai/opportunity-fit-types";
import { listFitCheckProfileOptionsServer } from "@/lib/documents/profile-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const sourceType = new URL(req.url).searchParams.get("sourceType");
  const parsed = z.enum(OPPORTUNITY_SOURCE_TYPES).safeParse(sourceType);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  const profiles = await listFitCheckProfileOptionsServer({
    organizationId: g.ctx.session.organizationId,
    sourceType: parsed.data,
  });

  return NextResponse.json({ profiles });
}
