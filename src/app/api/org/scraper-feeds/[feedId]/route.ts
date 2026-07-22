import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  guardAdminFeature,
  guardPermissionAction,
} from "@/lib/platform/guard-admin-feature";
import {
  deleteScraperFeedServer,
  getScraperFeedServer,
  updateScraperFeedServer,
} from "@/lib/scrapers/feeds-server";
import { runScraperFeedByIdServer } from "@/lib/scrapers/run-feeds-server";
import { recordScraperRunOrgActivity } from "@/lib/scrapers/record-scraper-run-activity";
import { recordAudit } from "@/lib/firestore/audit";
import { scraperFeedIntervalSchema } from "@/lib/scrapers/scraper-feed-interval-schema";

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    platform: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()).optional(),
    category: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()).optional(),
    feedUrl: z.string().url().max(2000).optional(),
    enabled: z.boolean().optional(),
  })
  .merge(scraperFeedIntervalSchema)
  .strict();

type RouteCtx = { params: Promise<{ feedId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { feedId } = await ctx.params;
  const feed = await getScraperFeedServer(g.ctx.session.organizationId, feedId);
  if (!feed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ feed });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const { feedId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof json === "object" &&
    json !== null &&
    (json as { action?: string }).action === "run"
  ) {
    const g = await guardPermissionAction("scrapers.run", {
      orAdminFeature: "scrapers",
    });
    if (!g.ok) return g.response;

    const result = await runScraperFeedByIdServer(g.ctx.session.organizationId, feedId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    void recordAudit({
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      event: "scraper.run",
      meta: { feedId, newCount: result.newCount },
    });
    void recordScraperRunOrgActivity({
      organizationId: g.ctx.session.organizationId,
      actorId: g.ctx.session.uid,
      newTotal: result.newCount,
      feedCount: 1,
      feedName: result.feedName,
    });
    return NextResponse.json({ result });
  }

  const g = await guardAdminFeature("scrapers");
  if (!g.ok) return g.response;

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await updateScraperFeedServer({
    organizationId: g.ctx.session.organizationId,
    feedId,
    uid: g.ctx.session.uid,
    patch: parsed.data,
  });
  if ("error" in updated) {
    return NextResponse.json({ error: updated.error }, { status: 404 });
  }
  return NextResponse.json({ feed: updated.feed });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("scrapers");
  if (!g.ok) return g.response;
  const { feedId } = await ctx.params;
  const deleted = await deleteScraperFeedServer(g.ctx.session.organizationId, feedId);
  if ("error" in deleted) {
    return NextResponse.json({ error: deleted.error }, { status: 404 });
  }
  void recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "scraper.feed_delete",
    meta: { feedId },
  });
  return NextResponse.json({ ok: true });
}
