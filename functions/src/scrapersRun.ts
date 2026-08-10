/**
 * Phase 1.4 — Due RSS scrapers + intake cleanup run on Cloud Functions
 * (Gen2 / Cloud Run), not App Hosting, so multi-tenant feed fan-out cannot
 * hang interactive instances.
 *
 * No AH postprocess: scrape, raw-item writes, org-activity, and cleanup are
 * all Firestore + RSS HTTP. Rollback: SCRAPERS_RUNTIME=apphosting.
 */
import { randomUUID } from "crypto";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import Parser from "rss-parser";

const FEED_CONCURRENCY = 4;
const RAW_ITEM_RETENTION_DAYS = 7;
const DEFAULT_INTAKE_POOL_EPOCH = 1;
const COLLECTIONS = {
  scraperFeeds: "scraperFeeds",
  scraperRawItems: "scraperRawItems",
  organizations: "organizations",
  orgActivityEvents: "orgActivityEvents",
} as const;

type ScraperFeed = {
  id: string;
  organizationId: string;
  name: string;
  platform: string;
  category: string;
  feedUrl: string;
  enabled: boolean;
  runIntervalMinutes: number;
};

type ParsedRssItem = {
  guid?: string;
  link: string;
  title: string;
  content: string;
  contentSnippet?: string;
  creator?: string;
  dcCreator?: string;
  pubDate?: string;
  isoDate?: string;
};

export type RunFeedResult = {
  feedId: string;
  feedName: string;
  ok: boolean;
  newCount: number;
  skipped: number;
  error?: string;
};

export type ScrapersDueRunResult = {
  orgCount: number;
  feedsRun: number;
  newItems: number;
  expiredDeleted: number;
  staleEpochDeleted: number;
  results: RunFeedResult[];
};

const parser = new Parser({
  customFields: {
    item: [["dc:creator", "dcCreator"]],
  },
  timeout: 25_000,
});

function db(): Firestore {
  return getFirestore();
}

function stampForCreate(
  organizationId: string,
  payload: Record<string, unknown>,
  uid?: string,
): Record<string, unknown> {
  return {
    ...payload,
    organizationId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(uid ? { createdByUid: uid, updatedByUid: uid } : {}),
  };
}

function stampForUpdate(payload: Record<string, unknown>, uid?: string): Record<string, unknown> {
  return {
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
    ...(uid ? { updatedByUid: uid } : {}),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function normalizeIntakePoolEpoch(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return DEFAULT_INTAKE_POOL_EPOCH;
}

function effectiveItemPoolEpoch(poolEpoch: unknown): number {
  return normalizeIntakePoolEpoch(poolEpoch);
}

function mapIsoField(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const d = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

function mapScraperFeed(id: string, raw: Record<string, unknown>): ScraperFeed {
  const minutes =
    typeof raw.runIntervalMinutes === "number" && Number.isFinite(raw.runIntervalMinutes)
      ? Math.max(1, Math.floor(raw.runIntervalMinutes))
      : 60;
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    name: String(raw.name ?? ""),
    platform: String(raw.platform ?? "other"),
    category: String(raw.category ?? "other"),
    feedUrl: String(raw.feedUrl ?? ""),
    enabled: raw.enabled !== false,
    runIntervalMinutes: minutes,
  };
}

async function fetchRssFeedItems(feedUrl: string): Promise<ParsedRssItem[]> {
  const feed = await parser.parseURL(feedUrl);
  const out: ParsedRssItem[] = [];
  for (const item of feed.items ?? []) {
    const link = (item.link ?? item.guid ?? "").trim();
    if (!link) continue;
    const title = (item.title ?? "").trim() || link;
    const raw = item as unknown as Record<string, unknown>;
    const encoded =
      typeof raw["content:encoded"] === "string" ? raw["content:encoded"] : undefined;
    const content =
      (item.content ?? encoded ?? item.contentSnippet ?? item.summary ?? title).trim() || title;
    const contentSnippet = (item.contentSnippet ?? item.summary ?? "").trim() || undefined;
    out.push({
      guid: item.guid?.trim() || undefined,
      link,
      title,
      content,
      contentSnippet,
      creator: item.creator?.trim() || undefined,
      dcCreator:
        typeof item.dcCreator === "string" ? item.dcCreator.trim() || undefined : undefined,
      pubDate: item.pubDate?.trim() || undefined,
      isoDate: item.isoDate?.trim() || undefined,
    });
  }
  return out;
}

function buildDedupeKey(item: Pick<ParsedRssItem, "guid" | "link">): string {
  const g = item.guid?.trim();
  if (g) return `guid:${g}`;
  return `link:${item.link.trim()}`;
}

function resolvePublishedAt(item: ParsedRssItem): string {
  const iso = item.isoDate?.trim();
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const pub = item.pubDate?.trim();
  if (pub) {
    const d = new Date(pub);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function rawItemExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + RAW_ITEM_RETENTION_DAYS);
  return d.toISOString();
}

async function getIntakePoolEpoch(organizationId: string): Promise<number> {
  const snap = await db().collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!snap.exists) return DEFAULT_INTAKE_POOL_EPOCH;
  return normalizeIntakePoolEpoch(snap.data()?.intakePoolEpoch);
}

async function findRawItemByDedupeKey(
  organizationId: string,
  dedupeKey: string,
): Promise<boolean> {
  const epoch = await getIntakePoolEpoch(organizationId);
  const snap = await db()
    .collection(COLLECTIONS.scraperRawItems)
    .where("organizationId", "==", organizationId)
    .where("dedupeKey", "==", dedupeKey)
    .limit(25)
    .get();
  if (snap.empty) return false;
  for (const doc of snap.docs) {
    if (effectiveItemPoolEpoch(doc.data()?.poolEpoch) === epoch) return true;
  }
  return false;
}

async function createScraperRawItem(
  organizationId: string,
  payload: {
    feedId: string;
    feedName: string;
    platform: string;
    category: string;
    dedupeKey: string;
    guid?: string;
    link: string;
    title: string;
    content: string;
    contentSnippet?: string;
    creator?: string;
    dcCreator?: string;
    pubDate?: string;
    isoDate?: string;
    publishedAt: string;
  },
): Promise<boolean> {
  if (await findRawItemByDedupeKey(organizationId, payload.dedupeKey)) return false;
  const poolEpoch = await getIntakePoolEpoch(organizationId);
  const now = new Date().toISOString();
  const ref = db().collection(COLLECTIONS.scraperRawItems).doc();
  await ref.set(
    stampForCreate(
      organizationId,
      stripUndefined({
        ...payload,
        poolEpoch,
        status: "available",
        expiresAt: rawItemExpiresAt(),
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
  return true;
}

async function runOneFeed(feed: ScraperFeed): Promise<RunFeedResult> {
  const base: RunFeedResult = {
    feedId: feed.id,
    feedName: feed.name,
    ok: false,
    newCount: 0,
    skipped: 0,
  };
  const ref = db().collection(COLLECTIONS.scraperFeeds).doc(feed.id);
  const now = new Date().toISOString();

  try {
    const items = await fetchRssFeedItems(feed.feedUrl);
    let newCount = 0;
    let skipped = 0;

    for (const item of items) {
      const dedupeKey = buildDedupeKey(item);
      if (await findRawItemByDedupeKey(feed.organizationId, dedupeKey)) {
        skipped += 1;
        continue;
      }
      const created = await createScraperRawItem(feed.organizationId, {
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
      if (created) newCount += 1;
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

async function listEnabledFeedsDue(organizationId?: string): Promise<ScraperFeed[]> {
  let q = db().collection(COLLECTIONS.scraperFeeds).where("enabled", "==", true);
  if (organizationId) {
    q = db()
      .collection(COLLECTIONS.scraperFeeds)
      .where("organizationId", "==", organizationId)
      .where("enabled", "==", true);
  }
  const snap = await q.get();
  const now = Date.now();
  const due: ScraperFeed[] = [];
  for (const doc of snap.docs) {
    const feed = mapScraperFeed(doc.id, doc.data() as Record<string, unknown>);
    const last = mapIsoField(
      (doc.data() as Record<string, unknown>).lastRunAt,
    );
    const lastMs = last ? new Date(last).getTime() : 0;
    if (now - lastMs >= feed.runIntervalMinutes * 60 * 1000) due.push(feed);
  }
  return due;
}

async function recordScraperRunOrgActivity(input: {
  organizationId: string;
  actorId: string;
  newTotal: number;
  feedCount: number;
  feedName?: string;
  scheduled?: boolean;
}): Promise<void> {
  const posts = `fetched ${input.newTotal} new post${input.newTotal === 1 ? "" : "s"}`;
  const body =
    input.feedName != null
      ? `${input.feedName}: ${posts}`
      : `${posts} from ${input.feedCount} feed${input.feedCount === 1 ? "" : "s"}`;
  const summary = input.scheduled
    ? `Scheduled scrape - ${body}`
    : body.charAt(0).toUpperCase() + body.slice(1);

  const oaId = `oa-${randomUUID()}`;
  await db()
    .collection(COLLECTIONS.orgActivityEvents)
    .doc(oaId)
    .set(
      stampForCreate(
        input.organizationId,
        {
          type: "scraper_run",
          actorId: input.actorId,
          summary,
          createdAt: new Date().toISOString(),
          href: "/intake",
          entityType: "scraper",
          payload: {
            newTotal: input.newTotal,
            feedCount: input.feedCount,
            feedName: input.feedName ?? null,
            scheduled: input.scheduled === true,
          },
        },
        input.actorId,
      ),
    );
}

async function deleteExpiredRawItems(): Promise<number> {
  const now = new Date().toISOString();
  const snap = await db()
    .collection(COLLECTIONS.scraperRawItems)
    .where("status", "==", "available")
    .where("expiresAt", "<", now)
    .limit(500)
    .get();
  if (snap.empty) return 0;
  const batch = db().batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

async function deleteStalePoolEpochItems(
  organizationId: string,
  currentEpoch: number,
): Promise<number> {
  if (currentEpoch <= 1) return 0;
  let deleted = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    const snap = await db()
      .collection(COLLECTIONS.scraperRawItems)
      .where("organizationId", "==", organizationId)
      .where("status", "==", "available")
      .orderBy("publishedAt", "desc")
      .limit(500)
      .get();
    if (snap.empty) break;
    const stale = snap.docs.filter(
      (doc) => effectiveItemPoolEpoch(doc.data()?.poolEpoch) < currentEpoch,
    );
    if (stale.length === 0) break;
    const batch = db().batch();
    for (const doc of stale) batch.delete(doc.ref);
    await batch.commit();
    deleted += stale.length;
    if (stale.length < snap.size) break;
  }
  return deleted;
}

async function cleanupIntakePool(): Promise<{
  expiredDeleted: number;
  staleEpochDeleted: number;
}> {
  const expiredDeleted = await deleteExpiredRawItems();
  let staleEpochDeleted = 0;
  const orgSnap = await db()
    .collection(COLLECTIONS.organizations)
    .select("intakePoolEpoch")
    .limit(500)
    .get();
  for (const doc of orgSnap.docs) {
    const epoch = effectiveItemPoolEpoch(doc.data()?.intakePoolEpoch);
    if (epoch <= 1) continue;
    staleEpochDeleted += await deleteStalePoolEpochItems(doc.id, epoch);
  }
  return { expiredDeleted, staleEpochDeleted };
}

async function runFeedsWithConcurrency(
  feeds: ScraperFeed[],
  onProgress?: (progress: {
    done: number;
    total: number;
    newTotal: number;
    result: RunFeedResult;
  }) => void | Promise<void>,
): Promise<RunFeedResult[]> {
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
        await onProgress?.({ done, total, newTotal, result });
      }),
    );
  }

  return results.filter((r): r is RunFeedResult => Boolean(r));
}

/** Scheduled cron: all orgs' due feeds + intake cleanup. */
export async function runDueScrapersOnFunctions(): Promise<ScrapersDueRunResult> {
  const due = await listEnabledFeedsDue();
  const byOrg = new Map<string, ScraperFeed[]>();
  for (const f of due) {
    const list = byOrg.get(f.organizationId) ?? [];
    list.push(f);
    byOrg.set(f.organizationId, list);
  }

  const results: RunFeedResult[] = [];
  for (const [organizationId, feeds] of byOrg.entries()) {
    const orgResults = await runFeedsWithConcurrency(feeds);
    results.push(...orgResults);
    if (orgResults.length > 0) {
      const newTotal = orgResults.reduce((n, r) => n + r.newCount, 0);
      void recordScraperRunOrgActivity({
        organizationId,
        actorId: "system",
        newTotal,
        feedCount: orgResults.length,
        scheduled: true,
      });
    }
  }

  const cleanup = await cleanupIntakePool();
  const newItems = results.reduce((n, r) => n + r.newCount, 0);
  return {
    orgCount: byOrg.size,
    feedsRun: results.length,
    newItems,
    expiredDeleted: cleanup.expiredDeleted,
    staleEpochDeleted: cleanup.staleEpochDeleted,
    results,
  };
}

/** Manual / API: one org's feeds (enabled, or force all). */
export async function runOrgScrapersOnFunctions(input: {
  organizationId: string;
  feedIds?: string[];
  force?: boolean;
  actorId?: string;
  onProgress?: (progress: {
    done: number;
    total: number;
    newTotal: number;
    result: RunFeedResult;
  }) => void | Promise<void>;
}): Promise<{ results: RunFeedResult[]; newTotal: number }> {
  let feeds: ScraperFeed[] = [];
  if (input.feedIds?.length) {
    for (const id of input.feedIds) {
      const snap = await db().collection(COLLECTIONS.scraperFeeds).doc(id).get();
      if (!snap.exists) continue;
      const feed = mapScraperFeed(snap.id, snap.data() as Record<string, unknown>);
      if (feed.organizationId !== input.organizationId) continue;
      if (feed.enabled || input.force) feeds.push(feed);
    }
  } else {
    const snap = await db()
      .collection(COLLECTIONS.scraperFeeds)
      .where("organizationId", "==", input.organizationId)
      .where("enabled", "==", true)
      .get();
    feeds = snap.docs.map((d) => mapScraperFeed(d.id, d.data() as Record<string, unknown>));
  }

  const results = await runFeedsWithConcurrency(feeds, input.onProgress);
  const newTotal = results.reduce((n, r) => n + r.newCount, 0);
  if (results.length > 0 && input.actorId) {
    void recordScraperRunOrgActivity({
      organizationId: input.organizationId,
      actorId: input.actorId,
      newTotal,
      feedCount: results.length,
    });
  }
  return { results, newTotal };
}
