import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import type { ScraperRawItem, ScraperRawItemStatus } from "@/lib/types";
import { RAW_ITEM_RETENTION_DAYS } from "@/lib/scrapers/default-feeds";
import { mapScraperRawItem } from "@/lib/scrapers/map-documents";
import {
  effectiveItemPoolEpoch,
  getIntakePoolEpochServer,
} from "@/lib/scrapers/intake-pool-epoch";

function rawCol() {
  const db = getAdminDb();
  if (!db) return null;
  return db.collection(COLLECTIONS.scraperRawItems);
}

export function rawItemExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + RAW_ITEM_RETENTION_DAYS);
  return d.toISOString();
}

/**
 * Find a raw item with the same dedupe key in the **current** pool epoch.
 * Older-epoch rows (hidden by Empty pool) do not block re-ingest.
 */
export async function findRawItemByDedupeKeyServer(
  organizationId: string,
  dedupeKey: string,
): Promise<ScraperRawItem | null> {
  const col = rawCol();
  if (!col) return null;
  const epoch = await getIntakePoolEpochServer(organizationId);
  const snap = await col
    .where("organizationId", "==", organizationId)
    .where("dedupeKey", "==", dedupeKey)
    .limit(25)
    .get();
  if (snap.empty) return null;
  for (const doc of snap.docs) {
    const item = mapScraperRawItem(doc.id, doc.data() as Record<string, unknown>);
    if (effectiveItemPoolEpoch(item.poolEpoch) === epoch) return item;
  }
  return null;
}

export async function createScraperRawItemServer(
  organizationId: string,
  payload: Omit<
    ScraperRawItem,
    "id" | "organizationId" | "createdAt" | "updatedAt" | "status" | "expiresAt" | "poolEpoch"
  > & { status?: ScraperRawItemStatus; poolEpoch?: number },
): Promise<{ ok: true; item: ScraperRawItem } | { error: string }> {
  const col = rawCol();
  if (!col) return { error: "Database not configured" };

  const existing = await findRawItemByDedupeKeyServer(organizationId, payload.dedupeKey);
  if (existing) return { error: "duplicate" };

  const poolEpoch =
    typeof payload.poolEpoch === "number" && payload.poolEpoch >= 1
      ? Math.floor(payload.poolEpoch)
      : await getIntakePoolEpochServer(organizationId);

  const now = new Date().toISOString();
  const ref = col.doc();
  const doc = {
    ...payload,
    poolEpoch,
    status: payload.status ?? "available",
    expiresAt: rawItemExpiresAt(),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(stampForCreate(organizationId, stripUndefined(doc)));
  const snap = await ref.get();
  return { ok: true, item: mapScraperRawItem(ref.id, snap.data() as Record<string, unknown>) };
}

export type ListRawItemsFilter = {
  organizationId: string;
  status?: ScraperRawItemStatus;
  platform?: string;
  category?: string;
  feedId?: string;
  limit?: number;
  /** Omit large HTML content bodies for list views. */
  lean?: boolean;
};

const inFlightRawItemLists = new Map<string, Promise<ScraperRawItem[]>>();

async function queryScraperRawItemsServer(
  filter: ListRawItemsFilter,
): Promise<ScraperRawItem[]> {
  const col = rawCol();
  if (!col) return [];

  const status = filter.status ?? "available";
  const limit = Math.min(500, Math.max(1, filter.limit ?? 200));
  const now = new Date().toISOString();
  // Over-fetch so expired / wrong-epoch rows can be filtered while still filling `limit`.
  const fetchLimit =
    status === "available" ? Math.min(500, Math.ceil(limit * 2.5)) : limit;

  let q = col
    .where("organizationId", "==", filter.organizationId)
    .where("status", "==", status);
  if (filter.platform) q = q.where("platform", "==", filter.platform);
  if (filter.category) q = q.where("category", "==", filter.category);

  let ordered = q.orderBy("publishedAt", "desc").limit(fetchLimit);
  if (filter.lean) {
    ordered = ordered.select(
      "organizationId",
      "feedId",
      "feedName",
      "platform",
      "category",
      "dedupeKey",
      "link",
      "title",
      "contentSnippet",
      "creator",
      "dcCreator",
      "publishedAt",
      "status",
      "poolEpoch",
      "expiresAt",
      "createdAt",
      "updatedAt",
    );
  }
  const snap = await ordered.get();
  let items = snap.docs.map((d) => mapScraperRawItem(d.id, d.data() as Record<string, unknown>));

  if (status === "available") {
    const epoch = await getIntakePoolEpochServer(filter.organizationId);
    items = items.filter(
      (i) =>
        (!i.expiresAt || i.expiresAt > now) &&
        effectiveItemPoolEpoch(i.poolEpoch) === epoch,
    );
  }
  if (filter.feedId) {
    items = items.filter((i) => i.feedId === filter.feedId);
  }

  return items.slice(0, limit);
}

/**
 * Coalesce identical concurrent reads. React development remounts and rapid filter changes can
 * otherwise start the same expensive Firestore query more than once.
 */
export function listScraperRawItemsServer(
  filter: ListRawItemsFilter,
): Promise<ScraperRawItem[]> {
  const key = JSON.stringify({
    organizationId: filter.organizationId,
    status: filter.status ?? "available",
    platform: filter.platform ?? "",
    category: filter.category ?? "",
    feedId: filter.feedId ?? "",
    limit: Math.min(500, Math.max(1, filter.limit ?? 200)),
    lean: filter.lean === true,
  });
  const existing = inFlightRawItemLists.get(key);
  if (existing) return existing;

  const request = queryScraperRawItemsServer(filter).finally(() => {
    if (inFlightRawItemLists.get(key) === request) {
      inFlightRawItemLists.delete(key);
    }
  });
  inFlightRawItemLists.set(key, request);
  return request;
}

export async function getScraperRawItemServer(
  organizationId: string,
  itemId: string,
): Promise<ScraperRawItem | null> {
  const col = rawCol();
  if (!col) return null;
  const snap = await col.doc(itemId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== organizationId) return null;
  return mapScraperRawItem(snap.id, data);
}

export async function dismissScraperRawItemServer(input: {
  organizationId: string;
  itemId: string;
  userId: string;
}): Promise<{ ok: true; item: ScraperRawItem } | { error: string }> {
  const col = rawCol();
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(input.itemId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Item not found" };
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== input.organizationId) return { error: "Item not found" };
  if (data.status === "promoted") return { error: "Already promoted" };

  const now = new Date().toISOString();
  await ref.update(
    stampForUpdate({
      status: "dismissed",
      dismissedAt: now,
      dismissedByUserId: input.userId,
    }),
  );
  const next = await ref.get();
  return { ok: true, item: mapScraperRawItem(ref.id, next.data() as Record<string, unknown>) };
}

const DISMISS_WRITE_CHUNK = 100;

async function dismissRawItemIdsServer(input: {
  organizationId: string;
  userId: string;
  ids: string[];
  progressBatchSize?: number;
  progressTotal?: number;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}): Promise<{ dismissedIds: string[] }> {
  const col = rawCol();
  if (!col) return { dismissedIds: [] };

  const now = new Date().toISOString();
  const stamp = stampForUpdate({
    status: "dismissed",
    dismissedAt: now,
    dismissedByUserId: input.userId,
  });
  const dismissed = new Set<string>();
  const db = getAdminDb()!;
  const batchSize = Math.min(
    DISMISS_WRITE_CHUNK,
    Math.max(1, input.progressBatchSize ?? DISMISS_WRITE_CHUNK),
  );
  const ids = input.ids;

  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const refs = slice.map((id) => col.doc(id));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let writes = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() as Record<string, unknown>;
      if (data.organizationId !== input.organizationId) continue;
      if (data.status === "promoted") continue;
      if (data.status === "dismissed") {
        dismissed.add(snap.id);
        continue;
      }
      batch.update(snap.ref, stamp);
      dismissed.add(snap.id);
      writes += 1;
    }
    if (writes > 0) await batch.commit();
    const done = dismissed.size;
    const total = Math.max(input.progressTotal ?? done, done);
    await input.onProgress?.(done, total);
  }

  return { dismissedIds: Array.from(dismissed) };
}

/** Soft-remove selected available items from the intake pool (status → dismissed). Max 500 ids. */
export async function dismissScraperRawItemsBulkServer(input: {
  organizationId: string;
  userId: string;
  itemIds: string[];
  progressBatchSize?: number;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}): Promise<{ ok: true; dismissedIds: string[]; totalMatched: number } | { error: string }> {
  const col = rawCol();
  if (!col) return { error: "Database not configured" };

  const raw = input.itemIds ?? [];
  if (raw.length === 0) return { error: "No items selected" };
  if (raw.length > 500) return { error: "Too many items (max 500)" };
  const ids = Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return { error: "No items selected" };

  const totalMatched = ids.length;
  await input.onProgress?.(0, totalMatched);
  const result = await dismissRawItemIdsServer({
    organizationId: input.organizationId,
    userId: input.userId,
    ids,
    progressBatchSize: input.progressBatchSize,
    progressTotal: totalMatched,
    onProgress: input.onProgress,
  });

  return { ok: true, dismissedIds: result.dismissedIds, totalMatched };
}

export async function markRawItemPromotedServer(input: {
  organizationId: string;
  itemId: string;
  userId: string;
  leadId: string;
}): Promise<{ ok: true; item: ScraperRawItem } | { error: string }> {
  const col = rawCol();
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(input.itemId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Item not found" };
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== input.organizationId) return { error: "Item not found" };
  if (data.status === "promoted") return { error: "Already promoted" };

  const now = new Date().toISOString();
  await ref.update(
    stampForUpdate({
      status: "promoted",
      promotedToLeadId: input.leadId,
      promotedAt: now,
      promotedByUserId: input.userId,
    }),
  );
  const next = await ref.get();
  return { ok: true, item: mapScraperRawItem(ref.id, next.data() as Record<string, unknown>) };
}

export async function deleteExpiredRawItemsServer(organizationId?: string): Promise<number> {
  const col = rawCol();
  if (!col) return 0;
  const now = new Date().toISOString();

  const q = organizationId
    ? col
        .where("organizationId", "==", organizationId)
        .where("status", "==", "available")
        .where("expiresAt", "<", now)
    : col.where("status", "==", "available").where("expiresAt", "<", now);

  const snap = await q.limit(500).get();
  if (snap.empty) return 0;

  const db = getAdminDb()!;
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snap.size;
}

/** Hard-delete available rows from previous pool generations after Empty pool. */
export async function deleteStalePoolEpochItemsServer(
  organizationId: string,
  currentEpoch: number,
): Promise<number> {
  if (currentEpoch <= 1) return 0;
  const col = rawCol();
  if (!col) return 0;
  const db = getAdminDb()!;
  let deleted = 0;

  for (let pass = 0; pass < 20; pass += 1) {
    const snap = await col
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

    const batch = db.batch();
    for (const doc of stale) batch.delete(doc.ref);
    await batch.commit();
    deleted += stale.length;
    if (stale.length < snap.size) break;
  }

  return deleted;
}

/** Cron helper: expire old available rows + remove hidden prior-epoch rows. */
export async function cleanupIntakePoolServer(): Promise<{
  expiredDeleted: number;
  staleEpochDeleted: number;
}> {
  const expiredDeleted = await deleteExpiredRawItemsServer();
  let staleEpochDeleted = 0;

  const db = getAdminDb();
  if (!db) return { expiredDeleted, staleEpochDeleted };

  const orgSnap = await db
    .collection(COLLECTIONS.organizations)
    .select("intakePoolEpoch")
    .limit(500)
    .get();

  for (const doc of orgSnap.docs) {
    const epoch = effectiveItemPoolEpoch(doc.data()?.intakePoolEpoch);
    if (epoch <= 1) continue;
    staleEpochDeleted += await deleteStalePoolEpochItemsServer(doc.id, epoch);
  }

  return { expiredDeleted, staleEpochDeleted };
}
