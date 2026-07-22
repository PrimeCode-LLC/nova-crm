import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForUpdate } from "@/lib/firestore/tenant-write";
import type { ScraperFeed } from "@/lib/types";
import {
  buildDedupeKey,
  fetchRssFeedItems,
  resolvePublishedAt,
} from "@/lib/scrapers/rss-fetch";
import { createScraperRawItemServer, findRawItemByDedupeKeyServer } from "@/lib/scrapers/raw-items-server";
import { getScraperFeedServer } from "@/lib/scrapers/feeds-server";

const FEED_CONCURRENCY = 4;

export type RunFeedResult = {
  feedId: string;
  feedName: string;
  ok: boolean;
  newCount: number;
  skipped: number;
  error?: string;
};

async function runOneFeed(feed: ScraperFeed): Promise<RunFeedResult> {
  const base: RunFeedResult = {
    feedId: feed.id,
    feedName: feed.name,
    ok: false,
    newCount: 0,
    skipped: 0,
  };

  const db = getAdminDb();
  if (!db) return { ...base, error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.scraperFeeds).doc(feed.id);
  const now = new Date().toISOString();

  try {
    const items = await fetchRssFeedItems(feed.feedUrl);
    let newCount = 0;
    let skipped = 0;

    for (const item of items) {
      const dedupeKey = buildDedupeKey(item);
      const existing = await findRawItemByDedupeKeyServer(feed.organizationId, dedupeKey);
      if (existing) {
        skipped += 1;
        continue;
      }

      const created = await createScraperRawItemServer(feed.organizationId, {
        feedId: feed.id,
        feedName: feed.name,
        platform: feed.platform,
        category: feed.category,
        dedupeKey,
        guid: item.guid,
        link: item.link,
        title: item.title,
        content: item.content,
        contentSnippet: item.contentSnippet,
        creator: item.creator,
        dcCreator: item.dcCreator,
        pubDate: item.pubDate,
        isoDate: item.isoDate,
        publishedAt: resolvePublishedAt(item),
      });

      if ("ok" in created && created.ok) newCount += 1;
      else skipped += 1;
    }

    await ref.update(
      stampForUpdate({
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: "",
        lastNewCount: newCount,
      }),
    );

    return { ...base, ok: true, newCount, skipped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref.update(
      stampForUpdate({
        lastRunAt: now,
        lastError: msg.slice(0, 2000),
        lastNewCount: 0,
      }),
    );
    return { ...base, error: msg };
  }
}

export async function runScraperFeedByIdServer(
  organizationId: string,
  feedId: string,
): Promise<RunFeedResult | { error: string }> {
  const feed = await getScraperFeedServer(organizationId, feedId);
  if (!feed) return { error: "Feed not found" };
  if (!feed.enabled) return { error: "Feed is disabled" };
  return runOneFeed(feed);
}

export async function runScraperFeedsServer(input: {
  organizationId: string;
  feedIds?: string[];
  force?: boolean;
  onProgress?: (progress: {
    done: number;
    total: number;
    newTotal: number;
    result: RunFeedResult;
  }) => void | Promise<void>;
}): Promise<{ results: RunFeedResult[] }> {
  const db = getAdminDb();
  if (!db) return { results: [] };

  let feeds: ScraperFeed[] = [];
  if (input.feedIds?.length) {
    for (const id of input.feedIds) {
      const f = await getScraperFeedServer(input.organizationId, id);
      if (f && (f.enabled || input.force)) feeds.push(f);
    }
  } else {
    const { mapScraperFeed } = await import("@/lib/scrapers/map-documents");
    const snap = await db
      .collection(COLLECTIONS.scraperFeeds)
      .where("organizationId", "==", input.organizationId)
      .where("enabled", "==", true)
      .get();
    feeds = snap.docs.map((d) => mapScraperFeed(d.id, d.data() as Record<string, unknown>));
  }

  const total = feeds.length;
  const results: RunFeedResult[] = new Array(total);
  let done = 0;
  let newTotal = 0;

  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const chunk = feeds.slice(i, i + FEED_CONCURRENCY);
    await Promise.all(
      chunk.map(async (feed, chunkIndex) => {
        const index = i + chunkIndex;
        const result = await runOneFeed(feed);
        results[index] = result;
        done += 1;
        newTotal += result.newCount;
        await input.onProgress?.({
          done,
          total,
          newTotal,
          result,
        });
      }),
    );
  }

  return { results: results.filter((result): result is RunFeedResult => Boolean(result)) };
}

export async function runAllOrganizationsScrapersDueServer(): Promise<{
  orgCount: number;
  results: RunFeedResult[];
}> {
  const { listEnabledFeedsDueForRunServer } = await import("@/lib/scrapers/feeds-server");
  const due = await listEnabledFeedsDueForRunServer();
  const byOrg = new Map<string, ScraperFeed[]>();
  for (const f of due) {
    const list = byOrg.get(f.organizationId) ?? [];
    list.push(f);
    byOrg.set(f.organizationId, list);
  }

  const results: RunFeedResult[] = [];
  for (const [organizationId, feeds] of byOrg.entries()) {
    const orgResults: RunFeedResult[] = [];
    for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
      const chunk = feeds.slice(i, i + FEED_CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map((f) => runOneFeed(f)));
      orgResults.push(...chunkResults);
    }
    results.push(...orgResults);

    if (orgResults.length > 0) {
      const newTotal = orgResults.reduce((n, r) => n + r.newCount, 0);
      const { recordScraperRunOrgActivity } = await import(
        "@/lib/scrapers/record-scraper-run-activity"
      );
      void recordScraperRunOrgActivity({
        organizationId,
        actorId: "system",
        newTotal,
        feedCount: orgResults.length,
        scheduled: true,
      });
    }
  }
  return { orgCount: byOrg.size, results };
}
