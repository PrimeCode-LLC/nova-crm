import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate } from "@/lib/documents/tenant-write";
import type { OrgActivityEventType } from "@/lib/types";

function newOrgActivityId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `oa-${crypto.randomUUID()}`;
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type IntakeActivityType = Extract<
  OrgActivityEventType,
  "intake_dismissed" | "intake_deleted" | "intake_pool_emptied"
>;

function summarize(input: {
  type: IntakeActivityType;
  count: number;
  title?: string;
}): string {
  const title = input.title?.trim();
  if (input.type === "intake_pool_emptied") {
    return "Emptied intake pool";
  }
  if (input.type === "intake_dismissed") {
    if (input.count === 1 && title) return `Dismissed intake post “${title}”`;
    if (input.count === 1) return "Dismissed 1 intake post";
    return `Dismissed ${input.count} intake posts`;
  }
  if (input.count === 1 && title) return `Permanently deleted intake post “${title}”`;
  if (input.count === 1) return "Permanently deleted 1 intake post";
  return `Permanently deleted ${input.count} intake posts`;
}

/** Writes a dashboard Live activity row for intake pool mutations. */
export async function recordIntakeOrgActivity(input: {
  organizationId: string;
  actorId: string;
  type: IntakeActivityType;
  count: number;
  title?: string;
  itemId?: string;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  if (input.count < 1 && input.type !== "intake_pool_emptied") return;

  const oaId = newOrgActivityId();
  await db.collection(COLLECTIONS.orgActivityEvents).doc(oaId).set(
    stampForCreate(
      input.organizationId,
      {
        type: input.type,
        actorId: input.actorId,
        summary: summarize(input),
        createdAt: new Date().toISOString(),
        href: "/intake",
        entityType: "scraperRawItem",
        entityId: input.itemId,
        payload: {
          count: input.count,
          title: input.title ?? null,
          itemId: input.itemId ?? null,
        },
      },
      input.actorId,
    ),
  );
}
