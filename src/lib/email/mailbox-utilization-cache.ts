/**
 * Redis-backed org mailbox utilization cache (P0.11).
 * Key: `dash:mailbox-util:v1:{organizationId}` — TTL ~60s.
 */

import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import type { MailboxUtilizationRow } from "@/lib/email/mailbox-utilization";
import { summarizeMailboxUtilization } from "@/lib/email/mailbox-utilization";

export type MailboxUtilizationCachePayload = {
  rows: MailboxUtilizationRow[];
  summary: ReturnType<typeof summarizeMailboxUtilization>;
  generatedAt: string;
};

export function mailboxUtilizationCacheKey(organizationId: string): string {
  return `dash:mailbox-util:v1:${organizationId.trim()}`;
}

export async function getCachedMailboxUtilization(
  organizationId: string,
): Promise<MailboxUtilizationCachePayload | null> {
  if (!isRedisConfigured()) return null;
  const orgId = organizationId.trim();
  if (!orgId) return null;
  try {
    return await cacheGetJson<MailboxUtilizationCachePayload>(
      mailboxUtilizationCacheKey(orgId),
    );
  } catch (err) {
    console.error("[mailbox-util] redis get failed", orgId, err);
    return null;
  }
}

export async function setCachedMailboxUtilization(
  organizationId: string,
  rows: MailboxUtilizationRow[],
): Promise<MailboxUtilizationCachePayload> {
  const payload: MailboxUtilizationCachePayload = {
    rows,
    summary: summarizeMailboxUtilization(rows),
    generatedAt: new Date().toISOString(),
  };
  if (isRedisConfigured()) {
    try {
      await cacheSetJson(
        mailboxUtilizationCacheKey(organizationId),
        payload,
        DEFAULT_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      console.error("[mailbox-util] redis set failed", organizationId, err);
    }
  }
  return payload;
}
