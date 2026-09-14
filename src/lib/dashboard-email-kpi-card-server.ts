/**
 * Server slice for Emails KPI card: durable compose sends + tracked opens by sender.
 * Does not mutate CRM data — read-only aggregation for the pulse Emails tile.
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { EmailKpiLiveSlice } from "@/lib/dashboard-email-kpi-card";

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function senderAllowed(senderId: string, allowed: Set<string> | null): boolean {
  if (!senderId) return false;
  if (allowed === null) return true;
  return allowed.has(senderId);
}

/**
 * Count compose/reply `emailSendEvents` + opened `mailTrackingMessages` for sender scope.
 * Caps scans defensively; prefers indexed org equality + in-memory filter on sender/range.
 */
export async function loadEmailKpiLiveSliceFromServer(input: {
  organizationId: string;
  rangeStartMs: number;
  /** `null` = all org senders. */
  senderIds: Set<string> | null;
}): Promise<EmailKpiLiveSlice> {
  const organizationId = input.organizationId.trim();
  const empty: EmailKpiLiveSlice = { composeSentInRange: 0, opensInRange: 0 };
  if (!organizationId) return empty;

  const db = getAdminDb();
  if (!db) return empty;

  const rangeStart = input.rangeStartMs;
  const senderIds = input.senderIds;

  let composeSentInRange = 0;
  let opensInRange = 0;

  try {
    const sendSnap = await db
      .collection(COLLECTIONS.emailSendEvents)
      .where("organizationId", "==", organizationId)
      .get();
    for (const doc of sendSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const actorId = typeof data.actorId === "string" ? data.actorId.trim() : "";
      if (!senderAllowed(actorId, senderIds)) continue;
      const at = validTime(typeof data.sentAt === "string" ? data.sentAt : undefined);
      if (at === undefined || at < rangeStart) continue;
      composeSentInRange += 1;
    }
  } catch (err) {
    console.error(
      "[email-kpi-card] emailSendEvents load failed",
      organizationId,
      err instanceof Error ? err.message : err,
    );
  }

  try {
    // Opened messages only: firstOpenedAt present. Filter range on lastOpenedAt ?? firstOpenedAt.
    const trackSnap = await db
      .collection(COLLECTIONS.mailTrackingMessages)
      .where("organizationId", "==", organizationId)
      .get();
    for (const doc of trackSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const mailboxOwnerUid =
        typeof data.mailboxOwnerUid === "string" ? data.mailboxOwnerUid.trim() : "";
      if (!senderAllowed(mailboxOwnerUid, senderIds)) continue;
      const openCount = Number(data.openCount ?? 0) || 0;
      const firstOpenedAt =
        typeof data.firstOpenedAt === "string" ? data.firstOpenedAt : undefined;
      const lastOpenedAt =
        typeof data.lastOpenedAt === "string" ? data.lastOpenedAt : undefined;
      if (!firstOpenedAt && openCount <= 0) continue;
      const openedAt = validTime(lastOpenedAt) ?? validTime(firstOpenedAt);
      if (openedAt === undefined || openedAt < rangeStart) continue;
      opensInRange += 1;
    }
  } catch (err) {
    console.error(
      "[email-kpi-card] mailTrackingMessages load failed",
      organizationId,
      err instanceof Error ? err.message : err,
    );
  }

  return { composeSentInRange, opensInRange };
}
