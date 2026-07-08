import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { listScraperRawItemsServer } from "@/lib/scrapers/raw-items-server";
import type { ScraperCategory, ScraperPlatform, ScraperRawItemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ScraperRawItemStatus | null;
  const platform = url.searchParams.get("platform") as ScraperPlatform | null;
  const category = url.searchParams.get("category") as ScraperCategory | null;
  const feedId = url.searchParams.get("feedId")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200");

  const items = await listScraperRawItemsServer({
    organizationId: g.ctx.session.organizationId,
    status: status && ["available", "promoted", "dismissed"].includes(status) ? status : "available",
    platform: platform ?? undefined,
    category: category ?? undefined,
    feedId,
    limit: Number.isFinite(limit) ? limit : 200,
  });

  return NextResponse.json({ items });
}
