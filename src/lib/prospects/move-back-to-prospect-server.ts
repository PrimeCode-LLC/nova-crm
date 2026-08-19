import { FieldValue, type DocumentReference } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForUpdate } from "@/lib/documents/tenant-write";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import { cancelScheduledEmailServer } from "@/lib/email/scheduled-emails-server";
import {
  moveBackBlockedReason,
  moveBackModeFor,
  type MoveBackMode,
} from "@/lib/prospects/move-back-to-prospect";
import { prospectOwnerIdOf } from "@/lib/prospects/prospect-access";
import type { Lead, OrgMemberRole, ProspectChannelAssignment } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";

function newTimelineEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `te-${crypto.randomUUID()}`;
  }
  return `te-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Clear push stamps so channels can be pushed again after an undo. */
function clearAssignmentPushes(
  assignments: ProspectChannelAssignment[] | undefined,
): Record<string, unknown>[] {
  return (assignments ?? []).map((a) => ({
    id: a.id,
    channel: a.channel,
    assigneeId: a.assigneeId,
    assignedAt: a.assignedAt,
    assignedById: a.assignedById,
  }));
}

function managerAncestorIdsFromUserData(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  if (Array.isArray(data.managerAncestorIds)) {
    return data.managerAncestorIds.filter((id): id is string => typeof id === "string");
  }
  return [];
}

function actorOwnsOrManages(
  actorId: string,
  ownerId: string,
  ownerData: Record<string, unknown> | undefined,
): boolean {
  if (!ownerId) return false;
  if (ownerId === actorId) return true;
  return managerAncestorIdsFromUserData(ownerData).includes(actorId);
}

/**
 * Cancel scheduled emails, close open follow-ups, and complete active/paused plans
 * for a sales lead before moving it back to prospect.
 */
async function cancelLeadOutreachForMoveBack(input: {
  organizationId: string;
  leadId: string;
  userId: string;
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
        reason: "Lead moved back to prospect",
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
          cancelReason: "Lead moved back to prospect",
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

export async function moveBackToProspectServer(input: {
  organizationId: string;
  leadId: string;
  userId: string;
  orgRole: OrgMemberRole;
}): Promise<
  | {
      ok: true;
      mode: MoveBackMode;
      prospectId: string;
      cancelledScheduled: number;
      closedFollowups: number;
      closedPlans: number;
    }
  | { error: string }
> {
  const db = getAdminDb();
  if (!db) return { error: "Database unavailable" };

  const leadRef = db.collection(COLLECTIONS.leads).doc(input.leadId);

  try {
    // Preflight reads + auth (outside mutation txn so we can cancel outreach first).
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) return { error: "Lead not found" };

    const leadRaw = leadSnap.data() as Record<string, unknown>;
    if (leadRaw.organizationId !== input.organizationId) {
      return { error: "Lead not in your organization" };
    }

    const lead = mapLeadDoc(leadSnap.id, leadRaw);
    const mode = moveBackModeFor(lead);
    if (!mode) {
      return { error: "This record is already a prospect." };
    }

    const dealsSnap = await db
      .collection(COLLECTIONS.deals)
      .where("leadId", "==", lead.id)
      .limit(5)
      .get();
    const hasDeal = dealsSnap.docs.some(
      (d) => (d.data() as Record<string, unknown>).organizationId === input.organizationId,
    );
    const blocked = moveBackBlockedReason(lead, { hasDeal });
    if (blocked) return { error: blocked };

    let sourceProspect: Lead | null = null;
    const sourceId = lead.prospectSourceId?.trim() ?? "";
    if (mode === "unpush_sales_lead") {
      if (!sourceId) return { error: "Missing linked prospect for this sales lead." };
      const sourceSnap = await db.collection(COLLECTIONS.leads).doc(sourceId).get();
      if (!sourceSnap.exists) return { error: "Source prospect not found." };
      const sourceRaw = sourceSnap.data() as Record<string, unknown>;
      if (sourceRaw.organizationId !== input.organizationId) {
        return { error: "Source prospect not in your organization." };
      }
      sourceProspect = mapLeadDoc(sourceSnap.id, sourceRaw);
    }

    const authorityOwnerId = sourceProspect
      ? prospectOwnerIdOf(sourceProspect)
      : prospectOwnerIdOf(lead) || lead.ownerId?.trim() || "";
    const ownerUserSnap = authorityOwnerId
      ? await db.collection(COLLECTIONS.users).doc(authorityOwnerId).get()
      : null;
    const ownerUserData = ownerUserSnap?.exists
      ? (ownerUserSnap.data() as Record<string, unknown>)
      : undefined;

    const allowed =
      roleAtLeast(input.orgRole, "admin") ||
      (mode === "unpush_sales_lead" &&
        Boolean(lead.sharedOwnerIds?.includes(input.userId))) ||
      actorOwnsOrManages(input.userId, authorityOwnerId, ownerUserData) ||
      (mode === "demote_inplace" && lead.ownerId?.trim() === input.userId);

    if (!allowed) {
      return { error: "You cannot move this lead back to prospect." };
    }

    const outreach = await cancelLeadOutreachForMoveBack({
      organizationId: input.organizationId,
      leadId: lead.id,
      userId: input.userId,
    });

    const result = await db.runTransaction(async (tx) => {
      const freshLeadSnap = await tx.get(leadRef);
      if (!freshLeadSnap.exists) return { error: "Lead not found" } as const;

      const freshRaw = freshLeadSnap.data() as Record<string, unknown>;
      if (freshRaw.organizationId !== input.organizationId) {
        return { error: "Lead not in your organization" } as const;
      }

      const freshLead = mapLeadDoc(freshLeadSnap.id, freshRaw);
      const freshMode = moveBackModeFor(freshLead);
      if (freshMode !== mode) {
        return { error: "Lead changed while moving back. Refresh and try again." } as const;
      }

      let sourceRef: DocumentReference | null = null;
      let freshSource: Lead | null = null;

      if (mode === "unpush_sales_lead") {
        const sid = freshLead.prospectSourceId?.trim() ?? "";
        if (!sid) return { error: "Missing linked prospect for this sales lead." } as const;
        sourceRef = db.collection(COLLECTIONS.leads).doc(sid);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists) return { error: "Source prospect not found." } as const;
        const sourceRaw = sourceSnap.data() as Record<string, unknown>;
        if (sourceRaw.organizationId !== input.organizationId) {
          return { error: "Source prospect not in your organization." } as const;
        }
        freshSource = mapLeadDoc(sourceSnap.id, sourceRaw);
        const linkedId = freshSource.linkedSalesLeadId?.trim() ?? "";
        if (linkedId && linkedId !== freshLead.id) {
          return {
            error: "Prospect is linked to a different sales lead. Refresh and try again.",
          } as const;
        }
      }

      const now = new Date().toISOString();
      const ownerId =
        mode === "unpush_sales_lead" && freshSource
          ? prospectOwnerIdOf(freshSource)
          : prospectOwnerIdOf(freshLead) || freshLead.ownerId;

      if (mode === "demote_inplace") {
        tx.update(
          leadRef,
          stampForUpdate(
            {
              intakeKind: "prospect",
              stage: "new",
              replyReviewStatus: FieldValue.delete(),
              lastActivityAt: now,
            },
            input.userId,
          ),
        );

        const teId = newTimelineEventId();
        tx.set(db.collection(COLLECTIONS.timelineEvents).doc(teId), {
          organizationId: input.organizationId,
          leadId: freshLead.id,
          leadOwnerId: ownerId || input.userId,
          type: "lead_moved_back_to_prospect",
          actorId: input.userId,
          summary: "Moved back to prospect (intake)",
          payload: {
            mode,
            previousStage: freshLead.stage,
            cancelledScheduled: outreach.cancelledScheduled,
            closedFollowups: outreach.closedFollowups,
            closedPlans: outreach.closedPlans,
          },
          createdAt: FieldValue.serverTimestamp(),
        });

        return { ok: true as const, mode, prospectId: freshLead.id };
      }

      if (!sourceRef || !freshSource) {
        return { error: "Source prospect missing." } as const;
      }

      tx.delete(leadRef);

      tx.update(
        sourceRef,
        stampForUpdate(
          {
            linkedSalesLeadId: FieldValue.delete(),
            prospectChannelAssignments: clearAssignmentPushes(
              freshSource.prospectChannelAssignments,
            ),
            lastActivityAt: now,
          },
          input.userId,
        ),
      );

      const teProspectId = newTimelineEventId();
      tx.set(db.collection(COLLECTIONS.timelineEvents).doc(teProspectId), {
        organizationId: input.organizationId,
        leadId: freshSource.id,
        leadOwnerId: ownerId || input.userId,
        type: "lead_moved_back_to_prospect",
        actorId: input.userId,
        summary: "Sales lead undone — returned to prospect",
        payload: {
          mode,
          removedSalesLeadId: freshLead.id,
          previousStage: freshLead.stage,
          cancelledScheduled: outreach.cancelledScheduled,
          closedFollowups: outreach.closedFollowups,
          closedPlans: outreach.closedPlans,
        },
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, mode, prospectId: freshSource.id };
    });

    if (!("ok" in result) || !result.ok) {
      return {
        error:
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Move back to prospect failed",
      };
    }

    return {
      ok: true,
      mode: result.mode,
      prospectId: result.prospectId,
      cancelledScheduled: outreach.cancelledScheduled,
      closedFollowups: outreach.closedFollowups,
      closedPlans: outreach.closedPlans,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg || "Move back to prospect failed" };
  }
}
