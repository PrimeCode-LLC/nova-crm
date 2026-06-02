import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  createScraperFeedServer,
  listScraperFeedsServer,
  seedDefaultScraperFeedsServer,
} from "@/lib/scrapers/feeds-server";
import { runScraperFeedsServer } from "@/lib/scrapers/run-feeds-server";
import { recordAudit } from "@/lib/firestore/audit";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  platform: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()),
  category: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()),
  feedUrl: z.string().url().max(2000),
  enabled: z.boolean().optional(),
  runIntervalMinutes: z.number().int().min(15).max(1440).optional(),
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const feeds = await listScraperFeedsServer(g.ctx.session.organizationId);
  return NextResponse.json({ feeds });
}

export async function POST(req: Request) {
  const g = await guardTenantApi({ minRole: "manager" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action =
    typeof json === "object" && json !== null && "action" in json
      ? String((json as { action: unknown }).action)
      : "create";

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  if (action === "seed") {
    const result = await seedDefaultScraperFeedsServer({ organizationId: orgId, uid });
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "scraper.feeds_seed",
      meta: { created: result.created, skipped: result.skipped },
    });
    return NextResponse.json(result);
  }

  if (action === "run_all") {
    const { results } = await runScraperFeedsServer({ organizationId: orgId, force: true });
    const newTotal = results.reduce((n, r) => n + r.newCount, 0);
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "scraper.run",
      meta: { feedCount: results.length, newTotal },
    });
    return NextResponse.json({ results, newTotal });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const created = await createScraperFeedServer({
    organizationId: orgId,
    uid,
    ...parsed.data,
  });
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  void recordAudit({
    organizationId: orgId,
    actorUid: uid,
    event: "scraper.feed_create",
    meta: { feedId: created.feed.id, name: created.feed.name },
  });

  return NextResponse.json({ feed: created.feed });
}
