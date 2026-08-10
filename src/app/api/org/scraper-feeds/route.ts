import { NextResponse } from "next/server";
import { z } from "zod";
import {
  scraperFeedIntervalSchema,
  scraperRunIntervalUnitSchema,
} from "@/lib/scrapers/scraper-feed-interval-schema";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  guardAdminFeature,
  guardPermissionAction,
} from "@/lib/platform/guard-admin-feature";
import {
  createScraperFeedServer,
  listScraperFeedsServer,
  seedDefaultScraperFeedsServer,
  setScraperFeedsEnabledServer,
  setScraperFeedsIntervalServer,
} from "@/lib/scrapers/feeds-server";
import { runScraperFeedsServer } from "@/lib/scrapers/run-feeds-server";
import { recordScraperRunOrgActivity } from "@/lib/scrapers/record-scraper-run-activity";
import {
  runOrgScrapersViaWorker,
  runOrgScrapersViaWorkerStream,
  scrapersWorkerEnabled,
} from "@/lib/scrapers/scrapers-worker-client";
import { recordAudit } from "@/lib/firestore/audit";

export const maxDuration = 300;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  platform: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()),
  category: z.string().trim().min(1).max(50).transform((v) => v.toLowerCase()),
  feedUrl: z.string().url().max(2000),
  enabled: z.boolean().optional(),
}).merge(scraperFeedIntervalSchema);

const bulkSetEnabledSchema = z.object({
  action: z.literal("bulk_set_enabled"),
  feedIds: z.array(z.string().min(1)).min(1).max(500),
  enabled: z.boolean(),
});

const bulkSetIntervalSchema = z.object({
  action: z.literal("bulk_set_interval"),
  feedIds: z.array(z.string().min(1)).min(1).max(500),
  runIntervalValue: z.number().int().positive(),
  runIntervalUnit: scraperRunIntervalUnitSchema,
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const feeds = await listScraperFeedsServer(g.ctx.session.organizationId);
  return NextResponse.json({ feeds });
}

export async function POST(req: Request) {
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

  if (action === "run_all") {
    const g = await guardPermissionAction("scrapers.run", {
      orAdminFeature: "scrapers",
    });
    if (!g.ok) return g.response;

    const orgId = g.ctx.session.organizationId;
    const uid = g.ctx.session.uid;
    const streamProgress =
      typeof json === "object" &&
      json !== null &&
      "streamProgress" in json &&
      (json as { streamProgress?: unknown }).streamProgress === true;

    if (streamProgress) {
      if (scrapersWorkerEnabled()) {
        try {
          const workerRes = await runOrgScrapersViaWorkerStream({
            organizationId: orgId,
            force: true,
            actorId: uid,
          });
          // Audit fires after stream completes on the worker path via a tee would be heavy;
          // record a start audit here; worker writes org-activity.
          void recordAudit({
            organizationId: orgId,
            actorUid: uid,
            event: "scraper.run",
            meta: { via: "functions_worker", stream: true },
          });
          return workerRes;
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "Scraper run_all worker stream failed",
              route: "/api/org/scraper-feeds",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return NextResponse.json({ error: "Could not run scrapers" }, { status: 502 });
        }
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          try {
            send({ type: "start" });
            const { results } = await runScraperFeedsServer({
              organizationId: orgId,
              force: true,
              onProgress: (progress) => {
                send({
                  type: "progress",
                  done: progress.done,
                  total: progress.total,
                  newTotal: progress.newTotal,
                  feedId: progress.result.feedId,
                  feedName: progress.result.feedName,
                  ok: progress.result.ok,
                  newCount: progress.result.newCount,
                  error: progress.result.error,
                });
              },
            });
            const newTotal = results.reduce((n, r) => n + r.newCount, 0);
            void recordAudit({
              organizationId: orgId,
              actorUid: uid,
              event: "scraper.run",
              meta: { feedCount: results.length, newTotal },
            });
            void recordScraperRunOrgActivity({
              organizationId: orgId,
              actorId: uid,
              newTotal,
              feedCount: results.length,
            });
            send({
              type: "complete",
              results,
              newTotal,
              feedCount: results.length,
            });
          } catch (error) {
            console.error(
              JSON.stringify({
                level: "error",
                message: "Scraper run_all stream failed",
                route: "/api/org/scraper-feeds",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            send({ type: "error", error: "Could not run scrapers" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (scrapersWorkerEnabled()) {
      try {
        const { results, newTotal } = await runOrgScrapersViaWorker({
          organizationId: orgId,
          force: true,
          actorId: uid,
        });
        void recordAudit({
          organizationId: orgId,
          actorUid: uid,
          event: "scraper.run",
          meta: { feedCount: results.length, newTotal, via: "functions_worker" },
        });
        return NextResponse.json({ results, newTotal });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Scraper run_all worker failed",
            route: "/api/org/scraper-feeds",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return NextResponse.json({ error: "Could not run scrapers" }, { status: 502 });
      }
    }

    const { results } = await runScraperFeedsServer({ organizationId: orgId, force: true });
    const newTotal = results.reduce((n, r) => n + r.newCount, 0);
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "scraper.run",
      meta: { feedCount: results.length, newTotal },
    });
    void recordScraperRunOrgActivity({
      organizationId: orgId,
      actorId: uid,
      newTotal,
      feedCount: results.length,
    });
    return NextResponse.json({ results, newTotal });
  }

  const g = await guardAdminFeature("scrapers");
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  if (action === "bulk_set_enabled") {
    const parsed = bulkSetEnabledSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const result = await setScraperFeedsEnabledServer({
      organizationId: orgId,
      uid,
      feedIds: [...new Set(parsed.data.feedIds)],
      enabled: parsed.data.enabled,
    });
    return NextResponse.json(result);
  }

  if (action === "bulk_set_interval") {
    const parsed = bulkSetIntervalSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const result = await setScraperFeedsIntervalServer({
      organizationId: orgId,
      uid,
      feedIds: [...new Set(parsed.data.feedIds)],
      runIntervalValue: parsed.data.runIntervalValue,
      runIntervalUnit: parsed.data.runIntervalUnit,
    });
    return NextResponse.json(result);
  }

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
