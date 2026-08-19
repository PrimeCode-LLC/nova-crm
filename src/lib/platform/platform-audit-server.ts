import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { ISODate, PlatformAuditEvent, PlatformAuditRecord } from "@/lib/types";

function tsToIso(v: { toDate?: () => Date } | undefined): ISODate {
  if (!v?.toDate) return new Date().toISOString();
  return v.toDate().toISOString();
}

export type RecordPlatformAuditInput = {
  event: PlatformAuditEvent;
  actorUid: string;
  actorEmail?: string;
  targetOrgId?: string;
  targetUid?: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

/** Append-only platform audit. Failures are swallowed so ops never block on logging. */
export async function recordPlatformAudit(input: RecordPlatformAuditInput): Promise<void> {
  try {
    const db = getAdminDb();
    if (!db) return;
    const ref = db.collection(COLLECTIONS.platformAudit).doc();
    await ref.set({
      event: input.event,
      actorUid: input.actorUid,
      actorEmail: input.actorEmail?.trim().toLowerCase() || null,
      targetOrgId: input.targetOrgId ?? null,
      targetUid: input.targetUid ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn(
      "[platform-audit] record failed",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function listPlatformAuditServer(
  limit = 100,
): Promise<PlatformAuditRecord[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.platformAudit)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      event: x.event as PlatformAuditEvent,
      actorUid: String(x.actorUid ?? ""),
      actorEmail: x.actorEmail ? String(x.actorEmail) : undefined,
      targetOrgId: x.targetOrgId ? String(x.targetOrgId) : undefined,
      targetUid: x.targetUid ? String(x.targetUid) : undefined,
      summary: String(x.summary ?? ""),
      metadata:
        x.metadata && typeof x.metadata === "object"
          ? (x.metadata as Record<string, unknown>)
          : undefined,
      createdAt: tsToIso(x.createdAt),
    };
  });
}
