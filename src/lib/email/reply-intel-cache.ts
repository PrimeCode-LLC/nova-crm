/**
 * Redis cache for reply-intelligence analytics list (P0.12).
 * Caches the expensive Firestore list; viewer filter + aggregate stay per-request.
 */

import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import type { ReplyActionAnalyticsRow } from "@/lib/email/reply-action-analytics";

export type ReplyIntelListCachePayload = {
  rows: ReplyActionAnalyticsRow[];
  generatedAt: string;
};

export function replyIntelListCacheKey(input: {
  organizationId: string;
  fromIso: string;
  toIso: string;
  classification?: string;
  status?: string;
}): string {
  const parts = [
    "dash:reply-intel:v1",
    input.organizationId.trim(),
    input.fromIso,
    input.toIso,
    input.classification?.trim() || "all",
    input.status?.trim() || "all",
  ];
  return parts.join(":");
}

export async function getCachedReplyIntelList(
  key: string,
): Promise<ReplyIntelListCachePayload | null> {
  if (!isRedisConfigured()) return null;
  try {
    const hit = await cacheGetJson<ReplyIntelListCachePayload>(key);
    if (!hit || !Array.isArray(hit.rows)) return null;
    return hit;
  } catch (err) {
    console.error("[reply-intel] redis get failed", key, err);
    return null;
  }
}

export async function setCachedReplyIntelList(
  key: string,
  rows: ReplyActionAnalyticsRow[],
): Promise<ReplyIntelListCachePayload> {
  const payload: ReplyIntelListCachePayload = {
    rows,
    generatedAt: new Date().toISOString(),
  };
  if (isRedisConfigured()) {
    try {
      await cacheSetJson(key, payload, DEFAULT_CACHE_TTL_SECONDS);
    } catch (err) {
      console.error("[reply-intel] redis set failed", key, err);
    }
  }
  return payload;
}
