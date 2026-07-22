import type { ScraperFeed, ScraperRawItem } from "@/lib/types";

/** Normalize Firestore Timestamp | ISO string | Date into an ISO string (or ""). */
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

export function mapScraperFeed(id: string, raw: Record<string, unknown>): ScraperFeed {
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    name: String(raw.name ?? ""),
    platform: (raw.platform as ScraperFeed["platform"]) ?? "other",
    category: (raw.category as ScraperFeed["category"]) ?? "other",
    feedUrl: String(raw.feedUrl ?? ""),
    enabled: raw.enabled !== false,
    runIntervalMinutes:
      typeof raw.runIntervalMinutes === "number" && raw.runIntervalMinutes > 0
        ? raw.runIntervalMinutes
        : 60,
    lastRunAt: mapIsoField(raw.lastRunAt) || undefined,
    lastSuccessAt: mapIsoField(raw.lastSuccessAt) || undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastNewCount: typeof raw.lastNewCount === "number" ? raw.lastNewCount : undefined,
    createdAt: mapIsoField(raw.createdAt),
    updatedAt: mapIsoField(raw.updatedAt),
    createdByUid: typeof raw.createdByUid === "string" ? raw.createdByUid : undefined,
  };
}

export function mapScraperRawItem(id: string, raw: Record<string, unknown>): ScraperRawItem {
  const createdAt = mapIsoField(raw.createdAt);
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    feedId: String(raw.feedId ?? ""),
    feedName: String(raw.feedName ?? ""),
    platform: (raw.platform as ScraperRawItem["platform"]) ?? "other",
    category: (raw.category as ScraperRawItem["category"]) ?? "other",
    dedupeKey: String(raw.dedupeKey ?? ""),
    guid: typeof raw.guid === "string" ? raw.guid : undefined,
    link: String(raw.link ?? ""),
    title: String(raw.title ?? ""),
    content: String(raw.content ?? ""),
    contentSnippet: typeof raw.contentSnippet === "string" ? raw.contentSnippet : undefined,
    creator: typeof raw.creator === "string" ? raw.creator : undefined,
    dcCreator: typeof raw.dcCreator === "string" ? raw.dcCreator : undefined,
    pubDate: typeof raw.pubDate === "string" ? raw.pubDate : undefined,
    isoDate: typeof raw.isoDate === "string" ? raw.isoDate : undefined,
    publishedAt: mapIsoField(raw.publishedAt) || createdAt,
    status: (raw.status as ScraperRawItem["status"]) ?? "available",
    poolEpoch:
      typeof raw.poolEpoch === "number" && Number.isFinite(raw.poolEpoch) && raw.poolEpoch >= 1
        ? Math.floor(raw.poolEpoch)
        : undefined,
    promotedToLeadId:
      typeof raw.promotedToLeadId === "string" ? raw.promotedToLeadId : undefined,
    promotedAt: mapIsoField(raw.promotedAt) || undefined,
    promotedByUserId:
      typeof raw.promotedByUserId === "string" ? raw.promotedByUserId : undefined,
    dismissedAt: mapIsoField(raw.dismissedAt) || undefined,
    dismissedByUserId:
      typeof raw.dismissedByUserId === "string" ? raw.dismissedByUserId : undefined,
    expiresAt: mapIsoField(raw.expiresAt),
    createdAt,
    updatedAt: mapIsoField(raw.updatedAt),
  };
}
