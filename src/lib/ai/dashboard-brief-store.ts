import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import {
  DASHBOARD_BRIEF_CACHE_TTL_MS,
  DASHBOARD_BRIEF_HISTORY_MAX,
} from "@/lib/ai/dashboard-brief-cache";
import type { ChannelKey } from "@/lib/types";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";

export type DashboardBriefPayload = {
  progress: string;
  risks: string[];
  suggestions: string[];
  watchList: { title: string; reason: string; href: string | null }[];
  cached?: boolean;
  cachedAt: string;
  historyId?: string;
};

export type DashboardBriefFilters = {
  filterHash: string;
  channelScope: ChannelKey[];
  ownerScope: string;
  timeRange: DashboardTimeRangeKey;
  ownerLabel: string;
};

type BriefCacheDoc = {
  result: DashboardBriefPayload;
  cachedAt: string;
  filterHash: string;
  historyId: string;
  filters: Omit<DashboardBriefFilters, "filterHash">;
};

type BriefHistoryDoc = BriefCacheDoc & {
  generatedAt: string;
  generatedByUserId: string;
};

function orgAiCacheRef(db: Firestore, orgId: string) {
  return db.collection(COLLECTIONS.organizations).doc(orgId).collection(ORG_SUBCOLLECTIONS.aiCache);
}

function orgBriefHistoryRef(db: Firestore, orgId: string) {
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiBriefHistory);
}

function briefCacheDocId(filterHash: string) {
  return `brief_${filterHash}`;
}

export async function getCachedDashboardBriefServer(
  orgId: string,
  filterHash: string,
): Promise<DashboardBriefPayload | null> {
  const db = getAdminDb();
  if (!db) return null;

  const snap = await orgAiCacheRef(db, orgId).doc(briefCacheDocId(filterHash)).get();
  if (!snap.exists) return null;

  const data = snap.data() as BriefCacheDoc;
  const age = Date.now() - new Date(data.cachedAt).getTime();
  if (age >= DASHBOARD_BRIEF_CACHE_TTL_MS) return null;

  return {
    ...data.result,
    cached: true,
    cachedAt: data.cachedAt,
    historyId: data.historyId,
  };
}

export async function saveDashboardBriefServer(input: {
  organizationId: string;
  userId: string;
  filters: DashboardBriefFilters;
  result: Omit<DashboardBriefPayload, "cached" | "cachedAt" | "historyId">;
}): Promise<DashboardBriefPayload> {
  const db = getAdminDb();
  const cachedAt = new Date().toISOString();
  const basePayload = {
    ...input.result,
    cached: false as const,
    cachedAt,
  };

  if (!db) {
    return basePayload;
  }

  const historyRef = orgBriefHistoryRef(db, input.organizationId).doc();
  const historyId = historyRef.id;

  const payload: DashboardBriefPayload = {
    ...basePayload,
    historyId,
  };

  const historyDoc: BriefHistoryDoc = {
    result: payload,
    cachedAt,
    filterHash: input.filters.filterHash,
    historyId,
    filters: {
      channelScope: input.filters.channelScope,
      ownerScope: input.filters.ownerScope,
      timeRange: input.filters.timeRange,
      ownerLabel: input.filters.ownerLabel,
    },
    generatedAt: cachedAt,
    generatedByUserId: input.userId,
  };

  const cacheDoc: BriefCacheDoc = {
    result: payload,
    cachedAt,
    filterHash: input.filters.filterHash,
    historyId,
    filters: historyDoc.filters,
  };

  const batch = db.batch();
  batch.set(historyRef, historyDoc);
  batch.set(
    orgAiCacheRef(db, input.organizationId).doc(briefCacheDocId(input.filters.filterHash)),
    cacheDoc,
  );
  await batch.commit();

  await trimDashboardBriefHistoryServer(db, input.organizationId);

  return payload;
}

async function trimDashboardBriefHistoryServer(db: Firestore, orgId: string) {
  const historyCol = orgBriefHistoryRef(db, orgId);
  const excess = await historyCol.orderBy("generatedAt", "desc").offset(DASHBOARD_BRIEF_HISTORY_MAX).get();

  if (excess.empty) return;

  const batch = db.batch();
  for (const doc of excess.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
}
