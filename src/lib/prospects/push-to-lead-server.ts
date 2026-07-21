import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { ownerManagerIdsFromUser } from "@/lib/crm-owner-managers";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import {
  canPushProspectChannel,
  prospectOwnerIdOf,
} from "@/lib/prospects/prospect-access";
import type { ChannelKey, Lead, ProspectChannelAssignment } from "@/lib/types";

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newTimelineEventId(): string {
  return newEntityId("te");
}

function omitProspectFields(lead: Lead): Record<string, unknown> {
  const {
    intakeKind: _ik,
    prospectOwnerId: _po,
    prospectVisibility: _pv,
    prospectChannelAssignments: _pca,
    prospectAssigneeIds: _pai,
    linkedSalesLeadId: _lsl,
    id: _id,
    createdAt: _ca,
    updatedAt: _ua,
    ...rest
  } = lead;
  return rest as Record<string, unknown>;
}

function buildSalesLeadFromProspect(
  prospect: Lead,
  salesLeadId: string,
  channel: ChannelKey,
  pusherId: string,
  now: string,
): Lead {
  const ownerId = prospectOwnerIdOf(prospect);
  const base = omitProspectFields(prospect);
  return {
    ...(base as Omit<Lead, "id" | "createdAt" | "updatedAt">),
    id: salesLeadId,
    channel,
    ownerId,
    prospectSourceId: prospect.id,
    channelTags: [channel],
    sharedOwnerIds: [pusherId],
    touches: prospect.touches ?? 0,
    isIdle: prospect.isIdle ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

function mergeChannelTags(existing: ChannelKey[] | undefined, channel: ChannelKey): ChannelKey[] {
  const tags = existing?.length ? [...existing] : [];
  if (!tags.includes(channel)) tags.push(channel);
  return tags;
}

function mergeSharedOwners(existing: string[] | undefined, userId: string): string[] {
  const ids = existing?.length ? [...existing] : [];
  if (!ids.includes(userId)) ids.push(userId);
  return ids;
}

function markAssignmentPushed(
  assignments: ProspectChannelAssignment[],
  assignmentId: string,
  userId: string,
  now: string,
): ProspectChannelAssignment[] {
  return assignments.map((a) =>
    a.id === assignmentId
      ? { ...a, pushedAt: now, pushedByUserId: userId }
      : a,
  );
}

/** Firestore rejects nested `undefined` in assignment maps (e.g. unpushed channels). */
function assignmentsForFirestore(
  assignments: ProspectChannelAssignment[],
): Record<string, unknown>[] {
  return assignments.map((a) => {
    const row: Record<string, unknown> = {
      id: a.id,
      channel: a.channel,
      assigneeId: a.assigneeId,
      assignedAt: a.assignedAt,
      assignedById: a.assignedById,
    };
    if (a.pushedAt) row.pushedAt = a.pushedAt;
    if (a.pushedByUserId) row.pushedByUserId = a.pushedByUserId;
    return row;
  });
}

export async function pushProspectChannelToLeadServer(input: {
  organizationId: string;
  prospectId: string;
  assignmentId: string;
  userId: string;
}): Promise<
  | { ok: true; salesLeadId: string; salesLead: Lead; created: boolean }
  | { error: string }
> {
  const db = getAdminDb();
  if (!db) return { error: "Database unavailable" };

  const prospectRef = db.collection(COLLECTIONS.leads).doc(input.prospectId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const prospectSnap = await tx.get(prospectRef);
      if (!prospectSnap.exists) return { error: "Prospect not found" } as const;

      const raw = prospectSnap.data() as Record<string, unknown>;
      if (raw.organizationId !== input.organizationId) {
        return { error: "Prospect not in your organization" } as const;
      }

      const prospect = mapLeadDoc(prospectSnap.id, raw);
      if (prospect.intakeKind !== "prospect") {
        return { error: "Not a prospect record" } as const;
      }

      if (!canPushProspectChannel(input.userId, prospect, input.assignmentId)) {
        return { error: "You cannot push this channel to a lead" } as const;
      }

      const assignment = prospect.prospectChannelAssignments?.find(
        (a) => a.id === input.assignmentId,
      );
      if (!assignment) return { error: "Channel assignment not found" } as const;

      const now = new Date().toISOString();
      const updatedAssignments = markAssignmentPushed(
        prospect.prospectChannelAssignments ?? [],
        input.assignmentId,
        input.userId,
        now,
      );

      let salesLeadId = prospect.linkedSalesLeadId?.trim() ?? "";
      let created = false;
      let salesLead: Lead;
      const ownerId = prospectOwnerIdOf(prospect);

      // All reads before writes (Firestore transaction rule).
      let salesRef = salesLeadId
        ? db.collection(COLLECTIONS.leads).doc(salesLeadId)
        : null;
      let salesSnap = salesRef ? await tx.get(salesRef) : null;
      const ownerUserSnap = ownerId
        ? await tx.get(db.collection(COLLECTIONS.users).doc(ownerId))
        : null;
      const ownerManagerIds = ownerUserSnap?.exists
        ? ownerManagerIdsFromUser((() => {
            const data = ownerUserSnap.data() as Record<string, unknown>;
            return {
              managerId: typeof data.managerId === "string" ? data.managerId : undefined,
              managerAncestorIds: Array.isArray(data.managerAncestorIds)
                ? data.managerAncestorIds.filter(
                    (id): id is string => typeof id === "string",
                  )
                : undefined,
            };
          })())
        : [];

      if (!salesLeadId) {
        salesLeadId = newEntityId("l");
        created = true;
        salesLead = buildSalesLeadFromProspect(
          prospect,
          salesLeadId,
          assignment.channel,
          input.userId,
          now,
        );

        salesRef = db.collection(COLLECTIONS.leads).doc(salesLeadId);
        tx.set(
          salesRef,
          stampForCreate(
            input.organizationId,
            stripUndefined({
              ...(salesLead as unknown as Record<string, unknown>),
              ownerManagerIds,
            }),
            input.userId,
          ),
        );
      } else {
        if (!salesSnap?.exists) {
          return { error: "Linked sales lead missing" } as const;
        }
        const salesRaw = salesSnap.data() as Record<string, unknown>;
        if (salesRaw.organizationId !== input.organizationId) {
          return { error: "Linked sales lead not in your organization" } as const;
        }

        const existing = mapLeadDoc(salesSnap.id, salesRaw);
        const channelTags = mergeChannelTags(existing.channelTags, assignment.channel);
        const sharedOwnerIds = mergeSharedOwners(existing.sharedOwnerIds, input.userId);

        salesLead = {
          ...existing,
          channelTags,
          sharedOwnerIds,
          channel: existing.channel ?? assignment.channel,
          updatedAt: now,
        };

        tx.update(
          salesRef!,
          stampForUpdate(
            {
              channelTags,
              sharedOwnerIds,
              channel: salesLead.channel,
            },
            input.userId,
          ),
        );
      }

      tx.update(
        prospectRef,
        stampForUpdate(
          {
            linkedSalesLeadId: salesLeadId,
            prospectChannelAssignments: assignmentsForFirestore(updatedAssignments),
          },
          input.userId,
        ),
      );

      const teProspectId = newTimelineEventId();
      const teSalesId = newTimelineEventId();

      tx.set(db.collection(COLLECTIONS.timelineEvents).doc(teProspectId), {
        organizationId: input.organizationId,
        leadId: prospect.id,
        leadOwnerId: ownerId,
        leadOwnerManagerIds: ownerManagerIds,
        type: "prospect_channel_pushed",
        actorId: input.userId,
        summary: `Channel pushed to shared lead (${assignment.channel})`,
        payload: {
          assignmentId: input.assignmentId,
          channel: assignment.channel,
          salesLeadId,
        },
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection(COLLECTIONS.timelineEvents).doc(teSalesId), {
        organizationId: input.organizationId,
        leadId: salesLeadId,
        leadOwnerId: ownerId,
        leadOwnerManagerIds: ownerManagerIds,
        type: "prospect_channel_pushed",
        actorId: input.userId,
        summary: `Added from prospect via ${assignment.channel}`,
        payload: {
          prospectId: prospect.id,
          assignmentId: input.assignmentId,
          channel: assignment.channel,
        },
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true as const, salesLeadId, salesLead, created };
    });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg || "Push to lead failed" };
  }
}
