import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate } from "@/lib/firestore/tenant-write";

function newOrgActivityId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `oa-${crypto.randomUUID()}`;
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Writes a dashboard Live activity row for a scraper fetch. */
export async function recordScraperRunOrgActivity(input: {
  organizationId: string;
  actorId: string;
  newTotal: number;
  feedCount: number;
  feedName?: string;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  const summary =
    input.feedName != null
      ? `${input.feedName}: fetched ${input.newTotal} new post${input.newTotal === 1 ? "" : "s"}`
      : `Fetched ${input.newTotal} new post${input.newTotal === 1 ? "" : "s"} from ${input.feedCount} feed${input.feedCount === 1 ? "" : "s"}`;

  const oaId = newOrgActivityId();
  await db.collection(COLLECTIONS.orgActivityEvents).doc(oaId).set(
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
        },
      },
      input.actorId,
    ),
  );
}
