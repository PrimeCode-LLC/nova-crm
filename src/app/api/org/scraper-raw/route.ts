import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  dismissScraperRawItemsBulkServer,
  listScraperRawItemsServer,
} from "@/lib/scrapers/raw-items-server";
import type { ScraperCategory, ScraperPlatform, ScraperRawItemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const startedAt = Date.now();
  const requestId = req.headers.get("x-vercel-id");
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ScraperRawItemStatus | null;
  const platform = url.searchParams.get("platform") as ScraperPlatform | null;
  const category = url.searchParams.get("category") as ScraperCategory | null;
  const feedId = url.searchParams.get("feedId")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200");

  try {
    const items = await listScraperRawItemsServer({
      organizationId: g.ctx.session.organizationId,
      status: status && ["available", "promoted", "dismissed"].includes(status) ? status : "available",
      platform: platform ?? undefined,
      category: category ?? undefined,
      feedId,
      limit: Number.isFinite(limit) ? limit : 200,
      lean: true,
    });

    // The Firestore query omits full HTML bodies; keep a compact plain-text list payload.
    const lean = items.map((item) => {
      const plain =
        item.contentSnippet?.trim() ||
        item.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return {
        ...item,
        content: plain.slice(0, 800),
        contentSnippet: plain.slice(0, 320),
      };
    });
    console.log(JSON.stringify({
      level: "info",
      message: "Intake pool loaded",
      route: "/api/org/scraper-raw",
      requestId,
      count: lean.length,
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json({ items: lean });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "Intake pool load failed",
      route: "/api/org/scraper-raw",
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json({ error: "Could not load intake pool" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const g = await guardAdminFeature("delete_intake_pool");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof json !== "object" || json === null) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = json as {
    action?: unknown;
    itemIds?: unknown;
    allAvailable?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "";

  if (action !== "dismiss") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const allAvailable = body.allAvailable === true;
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((id): id is string => typeof id === "string")
    : undefined;

  if (!allAvailable && (!itemIds || itemIds.length === 0)) {
    return NextResponse.json({ error: "No items selected" }, { status: 400 });
  }

  const result = await dismissScraperRawItemsBulkServer({
    organizationId: g.ctx.session.organizationId,
    userId: g.ctx.session.uid,
    allAvailable,
    itemIds: allAvailable ? undefined : itemIds,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    dismissedIds: result.dismissedIds,
    count: result.dismissedIds.length,
    totalMatched: result.totalMatched,
  });
}
