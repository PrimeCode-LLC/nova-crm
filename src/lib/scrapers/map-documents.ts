import type { ScraperFeed, ScraperRawItem } from "@/lib/types";

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
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : undefined,
    lastSuccessAt: typeof raw.lastSuccessAt === "string" ? raw.lastSuccessAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastNewCount: typeof raw.lastNewCount === "number" ? raw.lastNewCount : undefined,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    createdByUid: typeof raw.createdByUid === "string" ? raw.createdByUid : undefined,
  };
}

export function mapScraperRawItem(id: string, raw: Record<string, unknown>): ScraperRawItem {
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
    publishedAt: String(raw.publishedAt ?? raw.createdAt ?? ""),
    status: (raw.status as ScraperRawItem["status"]) ?? "available",
    promotedToLeadId:
      typeof raw.promotedToLeadId === "string" ? raw.promotedToLeadId : undefined,
    promotedAt: typeof raw.promotedAt === "string" ? raw.promotedAt : undefined,
    promotedByUserId:
      typeof raw.promotedByUserId === "string" ? raw.promotedByUserId : undefined,
    dismissedAt: typeof raw.dismissedAt === "string" ? raw.dismissedAt : undefined,
    dismissedByUserId:
      typeof raw.dismissedByUserId === "string" ? raw.dismissedByUserId : undefined,
    expiresAt: String(raw.expiresAt ?? ""),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}
