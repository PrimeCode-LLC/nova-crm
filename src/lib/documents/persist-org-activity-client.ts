import { doc, setDoc } from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stripUndefined } from "@/lib/documents/strip-undefined";
import type { OrgActivityEvent } from "@/lib/types";

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
    }) as Record<string, unknown>,
  );
}
