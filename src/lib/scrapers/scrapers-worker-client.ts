/**
 * P1.4 — App Hosting proxies long manual scraper runs to Cloud Functions
 * when SCRAPERS_RUNTIME is not `apphosting` and SCRAPERS_WORKER_URL is set.
 */
import type { RunFeedResult } from "@/lib/scrapers/run-feeds-server";

function scrapersRuntime(): string {
  return (process.env.SCRAPERS_RUNTIME ?? "functions").trim().toLowerCase() || "functions";
}

export function scrapersWorkerEnabled(): boolean {
  if (scrapersRuntime() === "apphosting") return false;
  return Boolean(process.env.SCRAPERS_WORKER_URL?.trim() && process.env.CRON_SECRET?.trim());
}

function workerUrl(): string {
  return process.env.SCRAPERS_WORKER_URL!.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET!.trim();
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export async function runOrgScrapersViaWorker(input: {
  organizationId: string;
  feedIds?: string[];
  force?: boolean;
  actorId?: string;
}): Promise<{ results: RunFeedResult[]; newTotal: number }> {
  const res = await fetch(workerUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      organizationId: input.organizationId,
      ...(input.feedIds?.length ? { feedIds: input.feedIds } : {}),
      force: input.force === true,
      ...(input.actorId ? { actorId: input.actorId } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    results?: RunFeedResult[];
    newTotal?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Scraper worker failed (${res.status})`);
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const newTotal =
    typeof body.newTotal === "number"
      ? body.newTotal
      : results.reduce((n, r) => n + (r.newCount ?? 0), 0);
  return { results, newTotal };
}

/** Proxies NDJSON progress stream from the CF worker to the caller. */
export async function runOrgScrapersViaWorkerStream(input: {
  organizationId: string;
  feedIds?: string[];
  force?: boolean;
  actorId?: string;
}): Promise<Response> {
  const res = await fetch(workerUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      organizationId: input.organizationId,
      ...(input.feedIds?.length ? { feedIds: input.feedIds } : {}),
      force: input.force === true,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      streamProgress: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 300) || `Scraper worker failed (${res.status})`);
  }
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
