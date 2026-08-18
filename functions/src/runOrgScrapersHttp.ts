/**
 * P1.4 — HTTPS entry for org-scoped manual scraper runs (off App Hosting).
 * Auth: Authorization Bearer CRON_SECRET (same as other cron workers).
 * App Hosting session routes proxy here after permission checks.
 */
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { runOrgScrapersOnFunctions } from "./scrapersRun";

const cronSecret = defineSecret("CRON_SECRET");

function unauthorized(res: { status: (code: number) => { json: (body: unknown) => void } }) {
  res.status(401).json({ error: "Unauthorized" });
}

export const runOrgScrapers = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [cronSecret],
    maxInstances: 3,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const secret = cronSecret.value()?.trim();
    const auth = String(req.get("authorization") ?? "");
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const headerSecret = String(req.get("x-cron-secret") ?? "").trim();
    if (!secret || (bearer !== secret && headerSecret !== secret)) {
      unauthorized(res);
      return;
    }

    const body = (req.body ?? {}) as {
      organizationId?: string;
      feedIds?: string[];
      force?: boolean;
      actorId?: string;
      streamProgress?: boolean;
    };

    const organizationId =
      typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!organizationId) {
      res.status(400).json({ error: "organizationId required" });
      return;
    }

    const feedIds = Array.isArray(body.feedIds)
      ? body.feedIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : undefined;
    const force = body.force === true;
    const actorId =
      typeof body.actorId === "string" && body.actorId.trim() ? body.actorId.trim() : undefined;

    if (body.streamProgress === true) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      const write = (event: Record<string, unknown>) => {
        res.write(`${JSON.stringify(event)}\n`);
      };
      try {
        write({ type: "start" });
        const { results, newTotal } = await runOrgScrapersOnFunctions({
          organizationId,
          feedIds,
          force,
          actorId,
          onProgress: (progress) => {
            write({
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
        write({
          type: "complete",
          results,
          newTotal,
          feedCount: results.length,
        });
      } catch (error) {
        write({
          type: "error",
          error: error instanceof Error ? error.message : "Could not run scrapers",
        });
      } finally {
        res.end();
      }
      return;
    }

    try {
      const { results, newTotal } = await runOrgScrapersOnFunctions({
        organizationId,
        feedIds,
        force,
        actorId,
      });
      res.json({ ok: true, results, newTotal, feedCount: results.length });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Could not run scrapers",
      });
    }
  },
);
