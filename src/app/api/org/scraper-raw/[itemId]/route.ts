import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  dismissScraperRawItemServer,
  getScraperRawItemServer,
} from "@/lib/scrapers/raw-items-server";

type RouteCtx = { params: Promise<{ itemId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { itemId } = await ctx.params;
  const item = await getScraperRawItemServer(g.ctx.session.organizationId, itemId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("delete_intake_pool");
  if (!g.ok) return g.response;
  const { itemId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action =
    typeof json === "object" && json !== null && "action" in json
      ? String((json as { action: unknown }).action)
      : "";

  if (action === "dismiss") {
    const result = await dismissScraperRawItemServer({
      organizationId: g.ctx.session.organizationId,
      itemId,
      userId: g.ctx.session.uid,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ item: result.item });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
