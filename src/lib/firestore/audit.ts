import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";

export type AuditEvent =
  | "member.invited"
  | "member.provisioned"
  | "member.joined"
  | "member.approved"
  | "member.role_changed"
  | "member.disabled"
  | "member.enabled"
  | "member.removed"
  | "org.open_join_link_rotated"
  | "org.open_join_link_cleared"
  | "invite.revoked"
  | "lead.created"
  | "lead.stage_changed"
  | "deal.created"
  | "deal.won"
  | "deal.lost"
  | "settings.updated";

/**
 * Append-only per-tenant audit log. Always-on side-channel — failures
 * are swallowed because audit must never break a primary write.
 */
export async function recordAudit(input: {
  organizationId: string;
  actorUid: string;
  event: AuditEvent;
  /** Free-form payload (must be JSON-serialisable). */
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getAdminDb();
    if (!db) return;
    await db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.audit)
      .add({
        organizationId: input.organizationId,
        actorUid: input.actorUid,
        event: input.event,
        meta: input.meta ?? {},
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (e) {
    // Surface in logs but never throw.
    console.error("[audit]", input.event, e);
  }
}
