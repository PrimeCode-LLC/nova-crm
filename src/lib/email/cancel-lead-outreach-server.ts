import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForUpdate } from "@/lib/documents/tenant-write";
import { cancelScheduledEmailServer } from "@/lib/email/scheduled-emails-server";

/**
 * Cancel scheduled emails, close open follow-ups, and complete active/paused plans
 * for a lead (e.g. hard-no / unsubscribe / move-back).
 */
export async function cancelLeadOutreachServer(input: {
  organizationId: string;
  leadId: string;
  userId: string;
  reason: string;
}): Promise<{ cancelledScheduled: number; closedFollowups: number; closedPlans: number }> {
  const db = getAdminDb();
  if (!db) return { cancelledScheduled: 0, closedFollowups: 0, closedPlans: 0 };

  const now = new Date().toISOString();
  let cancelledScheduled = 0;
  let closedFollowups = 0;
  let closedPlans = 0;

  const followupsSnap = await db
    .collection(COLLECTIONS.followups)
    .where("leadId", "==", input.leadId)
    .limit(100)
    .get();

  for (const d of followupsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.organizationId !== input.organizationId) continue;
    if (data.completedAt) continue;

    const scheduledEmailId =
      typeof data.scheduledEmailId === "string" ? data.scheduledEmailId.trim() : "";
    const ownerId = typeof data.ownerId === "string" ? data.ownerId.trim() : "";

    if (scheduledEmailId) {
      const cancel = await cancelScheduledEmailServer({
        organizationId: input.organizationId,
        uid: ownerId || input.userId,
        id: scheduledEmailId,
        reason: input.reason,
        followupId: d.id,
        fallbackUids: [input.userId],
      });
      if ("ok" in cancel && cancel.ok) cancelledScheduled += 1;
    }

    await d.ref.update(
      stampForUpdate(
        {
          completedAt: now,
          deliveryStatus: "cancelled",
          cancelledAt: now,
          cancelReason: input.reason,
          pausedAt: FieldValue.delete(),
          scheduledEmailId: FieldValue.delete(),
          emailScheduledAt: FieldValue.delete(),
        },
        input.userId,
      ),
    );
    closedFollowups += 1;
  }

  const plansSnap = await db
    .collection(COLLECTIONS.followupPlans)
    .where("leadId", "==", input.leadId)
    .limit(20)
    .get();

  for (const d of plansSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.organizationId !== input.organizationId) continue;
    const status = String(data.status ?? "");
    if (status !== "active" && status !== "paused") continue;

    await d.ref.update(
      stampForUpdate(
        {
          status: "completed",
          completedAt: now,
          pausedAt: FieldValue.delete(),
          pausedReason: FieldValue.delete(),
          replyMessageId: FieldValue.delete(),
        },
        input.userId,
      ),
    );
    closedPlans += 1;
  }

  return { cancelledScheduled, closedFollowups, closedPlans };
}
