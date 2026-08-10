/**
 * Person-scoped dashboard task gauges — Admin SDK + Redis (P0.11).
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheDel,
  cacheGetJson,
  cacheSetJson,
  isRedisConfigured,
} from "@/lib/cache/redis";
import {
  computePersonDashboardTaskGauges,
  personDashboardCacheKey,
  type PersonDashboardTaskGauges,
} from "@/lib/dashboard-person-summary";

export type { PersonDashboardTaskGauges } from "@/lib/dashboard-person-summary";
export { personDashboardCacheKey, computePersonDashboardTaskGauges } from "@/lib/dashboard-person-summary";

export async function getPersonDashboardTaskGaugesServer(
  organizationId: string,
  userId: string,
): Promise<{ gauges: PersonDashboardTaskGauges; source: "redis" | "firestore" } | null> {
  const orgId = organizationId.trim();
  const uid = userId.trim();
  if (!orgId || !uid) return null;

  const cacheKey = personDashboardCacheKey(orgId, uid);
  if (isRedisConfigured()) {
    const cached = await cacheGetJson<PersonDashboardTaskGauges>(cacheKey);
    if (
      cached &&
      typeof cached.myOpenTasks === "number" &&
      typeof cached.overdueTasks === "number" &&
      typeof cached.waitingOnOthers === "number"
    ) {
      return { gauges: cached, source: "redis" };
    }
  }

  const db = getAdminDb();
  if (!db) return null;

  const [assignedSnap, createdSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.leadTasks)
      .where("organizationId", "==", orgId)
      .where("assigneeId", "==", uid)
      .get(),
    db
      .collection(COLLECTIONS.leadTasks)
      .where("organizationId", "==", orgId)
      .where("createdById", "==", uid)
      .get(),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const doc of assignedSnap.docs) byId.set(doc.id, doc.data() as Record<string, unknown>);
  for (const doc of createdSnap.docs) byId.set(doc.id, doc.data() as Record<string, unknown>);

  const computed = computePersonDashboardTaskGauges([...byId.values()], uid);
  const gauges: PersonDashboardTaskGauges = {
    ...computed,
    updatedAt: new Date().toISOString(),
  };

  if (isRedisConfigured()) {
    try {
      await cacheSetJson(cacheKey, gauges, DEFAULT_CACHE_TTL_SECONDS);
    } catch (err) {
      console.error("[person-dashboard] redis set failed", orgId, uid, err);
    }
  }

  return { gauges, source: "firestore" };
}

export async function invalidatePersonDashboardTaskGauges(
  organizationId: string,
  userId: string,
): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    await cacheDel(personDashboardCacheKey(organizationId, userId));
  } catch (err) {
    console.error("[person-dashboard] redis del failed", organizationId, userId, err);
  }
}
