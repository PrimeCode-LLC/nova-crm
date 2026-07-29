import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForUpdate } from "@/lib/firestore/tenant-write";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
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

function actorOwnsOrManages(actorId: string, ownerId: string, ownerData: Record<string, unknown> | undefined): boolean {
  if (!ownerId) return false;
  if (ownerId === actorId) return true;
  return managerAncestorIdsFromUserData(ownerData).includes(actorId);
}

export async function moveBackToProspectServer(input: {
  organizationId: string;
  leadId: string;
  userId: string;
  orgRole: OrgMemberRole;
}): Promise<
  | { ok: true; mode: MoveBackMode; prospectId: string }
  | { error: string }
> {
  const db = getAdminDb();
  if (!db) return { error: "Database unavailable" };

  const leadRef = db.collection(COLLECTIONS.leads).doc(input.leadId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const leadSnap = await tx.get(leadRef);
      if (!leadSnap.exists) return { error: "Lead not found" } as const;

      const leadRaw = leadSnap.data() as Record<string, unknown>;
      if (leadRaw.organizationId !== input.organizationId) {
        return { error: "Lead not in your organization" } as const;
      }

      const lead = mapLeadDoc(leadSnap.id, leadRaw);
      const mode = moveBackModeFor(lead);
      if (!mode) {
        return { error: "This record was not promoted from a prospect." } as const;
      }

      const dealsSnap = await tx.get(
        db.collection(COLLECTIONS.deals).where("leadId", "==", lead.id).limit(5),
      );
      const hasDeal = dealsSnap.docs.some(
        (d) => (d.data() as Record<string, unknown>).organizationId === input.organizationId,
      );
      const blocked = moveBackBlockedReason(lead, { hasDeal });
      if (blocked) return { error: blocked } as const;

      let sourceProspect: Lead | null = null;
      let sourceRef: DocumentReference | null = null;
      const sourceId = lead.prospectSourceId?.trim() ?? "";

      if (mode === "unpush_sales_lead") {
        if (!sourceId) {
          return { error: "Missing linked prospect for this sales lead." } as const;
        }
        sourceRef = db.collection(COLLECTIONS.leads).doc(sourceId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists) {
          return { error: "Source prospect not found." } as const;
        }
        const sourceRaw = sourceSnap.data() as Record<string, unknown>;
        if (sourceRaw.organizationId !== input.organizationId) {
          return { error: "Source prospect not in your organization." } as const;
        }
        sourceProspect = mapLeadDoc(sourceSnap.id, sourceRaw);
      }

      const authorityOwnerId = sourceProspect
        ? prospectOwnerIdOf(sourceProspect)
        : prospectOwnerIdOf(lead) || lead.ownerId?.trim() || "";
      const ownerUserSnap = authorityOwnerId
        ? await tx.get(db.collection(COLLECTIONS.users).doc(authorityOwnerId))
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
        return { error: "You cannot move this lead back to prospect." } as const;
      }

      const now = new Date().toISOString();
      const ownerId =
        mode === "unpush_sales_lead" && sourceProspect
          ? prospectOwnerIdOf(sourceProspect)
          : prospectOwnerIdOf(lead) || lead.ownerId;

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
          leadId: lead.id,
          leadOwnerId: ownerId || input.userId,
          type: "lead_moved_back_to_prospect",
          actorId: input.userId,
          summary: "Moved back to prospect (intake)",
          payload: {
            mode,
            previousStage: lead.stage,
          },
          createdAt: FieldValue.serverTimestamp(),
        });

        return { ok: true as const, mode, prospectId: lead.id };
      }

      // unpush_sales_lead
      if (!sourceRef || !sourceProspect) {
        return { error: "Source prospect missing." } as const;
      }

      const linkedId = sourceProspect.linkedSalesLeadId?.trim() ?? "";
      if (linkedId && linkedId !== lead.id) {
        return {
          error: "Prospect is linked to a different sales lead. Refresh and try again.",
        } as const;
      }

      tx.delete(leadRef);

      tx.update(
        sourceRef,
        stampForUpdate(
          {
            linkedSalesLeadId: FieldValue.delete(),
            prospectChannelAssignments: clearAssignmentPushes(
              sourceProspect.prospectChannelAssignments,
            ),
            lastActivityAt: now,
          },
          input.userId,
        ),
      );

      const teProspectId = newTimelineEventId();
      tx.set(db.collection(COLLECTIONS.timelineEvents).doc(teProspectId), {
        organizationId: input.organizationId,
        leadId: sourceProspect.id,
        leadOwnerId: ownerId || input.userId,
        type: "lead_moved_back_to_prospect",
        actorId: input.userId,
        summary: "Sales lead undone — returned to prospect",
        payload: {
          mode,
          removedSalesLeadId: lead.id,
          previousStage: lead.stage,
        },
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, mode, prospectId: sourceProspect.id };
    });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg || "Move back to prospect failed" };
  }
}
