/**
 * Content-ops KPI summary — Admin SDK + Redis (P0.12).
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import {
  computeContentOpsOrgGauges,
  computeContentOpsPersonGauges,
  contentOpsOrgCacheKey,
  contentOpsPersonCacheKey,
  type ContentOpsOrgGauges,
  type ContentOpsPersonGauges,
} from "@/lib/content-ops-summary";

export type { ContentOpsOrgGauges, ContentOpsPersonGauges } from "@/lib/content-ops-summary";

async function loadContentCollections(organizationId: string) {
  const db = getAdminDb();
  if (!db) return null;
  const [itemsSnap, brandsSnap, capturesSnap] = await Promise.all([
    db.collection(COLLECTIONS.contentItems).where("organizationId", "==", organizationId).get(),
    db.collection(COLLECTIONS.contentBrands).where("organizationId", "==", organizationId).get(),
    db.collection(COLLECTIONS.contentCaptures).where("organizationId", "==", organizationId).get(),
  ]);
  return {
    items: itemsSnap.docs.map((d) => d.data() as Record<string, unknown>),
    brands: brandsSnap.docs.map((d) => d.data() as Record<string, unknown>),
    captures: capturesSnap.docs.map((d) => d.data() as Record<string, unknown>),
  };
}

export async function getContentOpsSummaryServer(
  organizationId: string,
  userId: string,
): Promise<{
  org: ContentOpsOrgGauges;
  person: ContentOpsPersonGauges;
  source: "redis" | "documents";
} | null> {
  const orgId = organizationId.trim();
  const uid = userId.trim();
  if (!orgId || !uid) return null;

  const orgKey = contentOpsOrgCacheKey(orgId);
  const personKey = contentOpsPersonCacheKey(orgId, uid);

  if (isRedisConfigured()) {
    const [orgCached, personCached] = await Promise.all([
      cacheGetJson<ContentOpsOrgGauges>(orgKey),
      cacheGetJson<ContentOpsPersonGauges>(personKey),
    ]);
    if (
      orgCached &&
      personCached &&
      typeof orgCached.scheduledThisWeek === "number" &&
      typeof personCached.myOpenSteps === "number"
    ) {
      return { org: orgCached, person: personCached, source: "redis" };
    }
  }

  const loaded = await loadContentCollections(orgId);
  if (!loaded) return null;

  const now = new Date().toISOString();
  const org: ContentOpsOrgGauges = {
    ...computeContentOpsOrgGauges(loaded),
    updatedAt: now,
  };
  const person: ContentOpsPersonGauges = {
    ...computeContentOpsPersonGauges(loaded.items, uid),
    updatedAt: now,
  };

  if (isRedisConfigured()) {
    await Promise.all([
      cacheSetJson(orgKey, org, DEFAULT_CACHE_TTL_SECONDS),
      cacheSetJson(personKey, person, DEFAULT_CACHE_TTL_SECONDS),
    ]);
  }

  return { org, person, source: "documents" };
}
