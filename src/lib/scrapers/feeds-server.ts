import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import type { ScraperCategory, ScraperFeed, ScraperPlatform } from "@/lib/types";
import { DEFAULT_SCRAPER_FEEDS } from "@/lib/scrapers/default-feeds";
import { mapScraperFeed } from "@/lib/scrapers/map-documents";

function feedsCol() {
  const db = getAdminDb();
  if (!db) return null;
  return db.collection(COLLECTIONS.scraperFeeds);
}

export async function listScraperFeedsServer(organizationId: string): Promise<ScraperFeed[]> {
  const col = feedsCol();
  if (!col) return [];
  const snap = await col.where("organizationId", "==", organizationId).get();
  const feeds = snap.docs.map((d) => mapScraperFeed(d.id, d.data() as Record<string, unknown>));
  feeds.sort((a, b) => a.name.localeCompare(b.name));
  return feeds;
}

export async function getScraperFeedServer(
  organizationId: string,
  feedId: string,
): Promise<ScraperFeed | null> {
  const col = feedsCol();
  if (!col) return null;
  const snap = await col.doc(feedId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== organizationId) return null;
  return mapScraperFeed(snap.id, data);
}

export async function createScraperFeedServer(input: {
  organizationId: string;
  uid?: string;
  name: string;
  platform: ScraperPlatform;
  category: ScraperCategory;
  feedUrl: string;
  enabled?: boolean;
  runIntervalMinutes?: number;
}): Promise<{ ok: true; feed: ScraperFeed } | { error: string }> {
  const col = feedsCol();
  if (!col) return { error: "Database not configured" };
  const now = new Date().toISOString();
  const ref = col.doc();
  const payload = {
    name: input.name.trim(),
    platform: input.platform,
    category: input.category,
    feedUrl: input.feedUrl.trim(),
    enabled: input.enabled !== false,
    runIntervalMinutes: Math.max(15, Math.min(24 * 60, input.runIntervalMinutes ?? 60)),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(stampForCreate(input.organizationId, payload, input.uid));
  const snap = await ref.get();
  return { ok: true, feed: mapScraperFeed(ref.id, snap.data() as Record<string, unknown>) };
}

export async function updateScraperFeedServer(input: {
  organizationId: string;
  feedId: string;
  uid?: string;
  patch: Partial<
    Pick<ScraperFeed, "name" | "platform" | "category" | "feedUrl" | "enabled" | "runIntervalMinutes">
  >;
}): Promise<{ ok: true; feed: ScraperFeed } | { error: string }> {
  const col = feedsCol();
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(input.feedId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Feed not found" };
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== input.organizationId) return { error: "Feed not found" };

  const patch: Record<string, unknown> = {};
  if (input.patch.name !== undefined) patch.name = input.patch.name.trim();
  if (input.patch.platform !== undefined) patch.platform = input.patch.platform;
  if (input.patch.category !== undefined) patch.category = input.patch.category;
  if (input.patch.feedUrl !== undefined) patch.feedUrl = input.patch.feedUrl.trim();
  if (input.patch.enabled !== undefined) patch.enabled = input.patch.enabled;
  if (input.patch.runIntervalMinutes !== undefined) {
    patch.runIntervalMinutes = Math.max(15, Math.min(24 * 60, input.patch.runIntervalMinutes));
  }

  await ref.update(stampForUpdate(patch, input.uid));
  const next = await ref.get();
  return { ok: true, feed: mapScraperFeed(ref.id, next.data() as Record<string, unknown>) };
}

export async function deleteScraperFeedServer(
  organizationId: string,
  feedId: string,
): Promise<{ ok: true } | { error: string }> {
  const col = feedsCol();
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(feedId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Feed not found" };
  if ((snap.data() as Record<string, unknown>).organizationId !== organizationId) {
    return { error: "Feed not found" };
  }
  await ref.delete();
  return { ok: true };
}

/** Idempotent: adds default n8n/rss.app feeds that are not already present (by feedUrl). */
export async function seedDefaultScraperFeedsServer(input: {
  organizationId: string;
  uid?: string;
}): Promise<{ created: number; skipped: number }> {
  const col = feedsCol();
  if (!col) return { created: 0, skipped: 0 };

  const existing = await listScraperFeedsServer(input.organizationId);
  const urls = new Set(existing.map((f) => f.feedUrl.trim().toLowerCase()));
  let created = 0;
  let skipped = 0;

  for (const seed of DEFAULT_SCRAPER_FEEDS) {
    const key = seed.feedUrl.trim().toLowerCase();
    if (urls.has(key)) {
      skipped += 1;
      continue;
    }
    const res = await createScraperFeedServer({
      organizationId: input.organizationId,
      uid: input.uid,
      ...seed,
      enabled: true,
      runIntervalMinutes: 60,
    });
    if ("ok" in res && res.ok) {
      created += 1;
      urls.add(key);
    }
  }
  return { created, skipped };
}

export async function listEnabledFeedsDueForRunServer(
  organizationId?: string,
): Promise<ScraperFeed[]> {
  const col = feedsCol();
  if (!col) return [];

  let q = col.where("enabled", "==", true);
  if (organizationId) {
    q = col.where("organizationId", "==", organizationId).where("enabled", "==", true);
  }
  const snap = await q.get();
  const now = Date.now();
  const due: ScraperFeed[] = [];

  for (const doc of snap.docs) {
    const feed = mapScraperFeed(doc.id, doc.data() as Record<string, unknown>);
    const intervalMs = feed.runIntervalMinutes * 60 * 1000;
    const last = feed.lastRunAt ? new Date(feed.lastRunAt).getTime() : 0;
    if (now - last >= intervalMs) due.push(feed);
  }
  return due;
}
