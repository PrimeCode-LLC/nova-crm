import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import type { ScraperRawItem, ScraperRawItemStatus } from "@/lib/types";
import { RAW_ITEM_RETENTION_DAYS } from "@/lib/scrapers/default-feeds";
import { mapScraperRawItem } from "@/lib/scrapers/map-documents";

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

export async function findRawItemByDedupeKeyServer(
  organizationId: string,
  dedupeKey: string,
): Promise<ScraperRawItem | null> {
  const col = rawCol();
  if (!col) return null;
  const snap = await col
    .where("organizationId", "==", organizationId)
    .where("dedupeKey", "==", dedupeKey)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return mapScraperRawItem(doc.id, doc.data() as Record<string, unknown>);
}

export async function createScraperRawItemServer(
  organizationId: string,
  payload: Omit<
    ScraperRawItem,
    "id" | "organizationId" | "createdAt" | "updatedAt" | "status" | "expiresAt"
  > & { status?: ScraperRawItemStatus },
): Promise<{ ok: true; item: ScraperRawItem } | { error: string }> {
  const col = rawCol();
  if (!col) return { error: "Database not configured" };

  const existing = await findRawItemByDedupeKeyServer(organizationId, payload.dedupeKey);
  if (existing) return { error: "duplicate" };

  const now = new Date().toISOString();
  const ref = col.doc();
  const doc = {
    ...payload,
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
};

export async function listScraperRawItemsServer(
  filter: ListRawItemsFilter,
): Promise<ScraperRawItem[]> {
  const col = rawCol();
  if (!col) return [];

  const status = filter.status ?? "available";
  const limit = Math.min(500, Math.max(1, filter.limit ?? 200));
  const now = new Date().toISOString();
  // Over-fetch slightly so filtering expired rows still returns up to `limit` items.
  const fetchLimit =
    status === "available" ? Math.min(500, Math.ceil(limit * 1.25)) : limit;

  let q = col
    .where("organizationId", "==", filter.organizationId)
    .where("status", "==", status);
  if (filter.platform) q = q.where("platform", "==", filter.platform);
  if (filter.category) q = q.where("category", "==", filter.category);

  const snap = await q.orderBy("publishedAt", "desc").limit(fetchLimit).get();
  let items = snap.docs.map((d) => mapScraperRawItem(d.id, d.data() as Record<string, unknown>));

  if (status === "available") {
    items = items.filter((i) => !i.expiresAt || i.expiresAt > now);
  }
  if (filter.feedId) {
    items = items.filter((i) => i.feedId === filter.feedId);
  }

  return items.slice(0, limit);
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
