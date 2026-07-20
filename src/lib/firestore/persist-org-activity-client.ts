import { doc, setDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { OrgActivityEvent } from "@/lib/types";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function persistOrgActivityEventCreate(
  db: Firestore,
  organizationId: string,
  event: OrgActivityEvent,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.orgActivityEvents, event.id),
    stripUndefined({
      ...event,
      organizationId,
      actorId: event.actorId,
      type: event.type,
      summary: event.summary,
      createdAt: event.createdAt,
      href: event.href ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      payload: event.payload ?? null,
    }),
  );
}
