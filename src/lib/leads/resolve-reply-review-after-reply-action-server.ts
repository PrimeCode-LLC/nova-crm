import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import {
  shouldOpenReplyReview,
  stageIsBeforeReplied,
} from "@/lib/leads/reply-review";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead, PipelineStage } from "@/lib/types";
import type { ReplyActionCompletionOutcome } from "@/lib/leads/reply-action-completion-types";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/firestore/tenant-write";

export type { ReplyActionCompletionOutcome } from "@/lib/leads/reply-action-completion-types";

function relatedIds(lead: Lead): string[] {
  const ids = new Set<string>([lead.id]);
  const linked = lead.linkedSalesLeadId?.trim();
  const source = lead.prospectSourceId?.trim();
  if (linked) ids.add(linked);
  if (source) ids.add(source);
  return [...ids];
}

/**
 * After a reply-intelligence action is sent or accepted, clear the parallel
 * "reply review" pending state and (when appropriate) move/promote to Replied
 * so dashboard Needs attention / Replies to review drop in one step.
 */
export async function resolveReplyReviewAfterReplyActionServer(input: {
  organizationId: string;
  leadId: string;
  actorUid: string;
  /**
   * `completed` = send or confirm next step (accept review + stage).
   * `suggestion_dismissed` = rejected AI suggestion only (leave stage review alone).
   */
  mode: "completed" | "suggestion_dismissed";
}): Promise<ReplyActionCompletionOutcome> {
  const empty: ReplyActionCompletionOutcome = {
    replyReviewResolved: false,
    stageMovedToReplied: false,
    promotedToLead: false,
    leadIds: [],
    clientPatches: [],
  };

  if (input.mode === "suggestion_dismissed") return empty;

  const db = getAdminDb();
  if (!db) return empty;

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists) return empty;
  const raw = leadSnap.data() as Record<string, unknown>;
  if (String(raw.organizationId ?? "") !== input.organizationId) return empty;

  const lead = mapLeadDoc(leadSnap.id, raw);
  const now = new Date().toISOString();
  const leadIds = relatedIds(lead);

  // Expand via linked docs.
  for (const id of [...leadIds]) {
    if (id === lead.id) continue;
    const snap = await db.collection(COLLECTIONS.leads).doc(id).get();
    if (!snap.exists) continue;
    if (String(snap.data()?.organizationId ?? "") !== input.organizationId) continue;
    const mapped = mapLeadDoc(snap.id, snap.data() as Record<string, unknown>);
    for (const related of relatedIds(mapped)) {
      if (!leadIds.includes(related)) leadIds.push(related);
    }
  }

  const leadById = new Map<string, Lead>();
  for (const id of leadIds) {
    const snap = await db.collection(COLLECTIONS.leads).doc(id).get();
    if (!snap.exists) continue;
    if (String(snap.data()?.organizationId ?? "") !== input.organizationId) continue;
    leadById.set(id, mapLeadDoc(snap.id, snap.data() as Record<string, unknown>));
  }

  const primary = leadById.get(input.leadId) ?? lead;
  const anyNeedsReview = [...leadById.values()].some(
    (row) => row.replyReviewStatus === "pending" && shouldOpenReplyReview(row),
  );

  // Even without replyReviewStatus, early-stage / prospect after a human reply
  // should land on Replied when the rep completes RI.
  const shouldPromoteOrMove =
    shouldOpenReplyReview(primary) ||
    primary.intakeKind === "prospect" ||
    stageIsBeforeReplied(primary.stage);

  if (!anyNeedsReview && !shouldPromoteOrMove) {
    return empty;
  }

  let stageMovedToReplied = false;
  let promotedToLead = false;
  const clientPatches: Array<{ leadId: string; patch: Partial<Lead> }> = [];

  const isProspect = isProspectRow(primary);
  const linkedSalesLeadId = primary.linkedSalesLeadId?.trim() || "";

  for (const id of leadIds) {
    const row = leadById.get(id);
    if (!row) continue;

    const patch: Record<string, unknown> = {
      replyReviewStatus: "accepted",
      lastActivityAt: now,
      updatedAt: now,
      temperature: "warm",
    };
    const clientPatch: Partial<Lead> = {
      replyReviewStatus: "accepted",
      lastActivityAt: now,
      temperature: "warm",
    };

    // Promote prospect → sales lead when this is the prospect row without a linked sales lead.
    if (isProspect && !linkedSalesLeadId && id === primary.id && row.intakeKind === "prospect") {
      patch.intakeKind = FieldValue.delete();
      clientPatch.intakeKind = undefined;
      if (!row.ownerId?.trim() && input.actorUid) {
        patch.ownerId = input.actorUid;
        clientPatch.ownerId = input.actorUid;
      }
      promotedToLead = true;
    }

    const nextStage: PipelineStage = "replied";
    const shouldMoveStage =
      row.stage !== "replied" &&
      row.stage !== "won" &&
      row.stage !== "lost" &&
      (stageIsBeforeReplied(row.stage) || row.intakeKind === "prospect" || promotedToLead);

    if (shouldMoveStage) {
      patch.stage = nextStage;
      clientPatch.stage = nextStage;
      stageMovedToReplied = true;
    }

    await db.collection(COLLECTIONS.leads).doc(id).set(patch, { merge: true });
    clientPatches.push({ leadId: id, patch: clientPatch });

    if (shouldMoveStage) {
      try {
        const leadOwnerId = row.ownerId?.trim() || input.actorUid;
        const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
        const teId = `te-${crypto.randomUUID()}`;
        await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
          stampForCreate(
            input.organizationId,
            {
              leadId: id,
              leadOwnerId,
              leadOwnerManagerIds,
              type: "stage_changed",
              actorId: input.actorUid,
              summary: `Moved from ${row.stage} → replied (reply intelligence completed)`,
              payload: {
                source: "reply_intelligence",
                previousStage: row.stage,
                nextStage: "replied",
              },
              createdAt: now,
            },
            input.actorUid,
          ),
        );
      } catch {
        /* timeline best-effort */
      }
    }
  }

  return {
    replyReviewResolved: true,
    stageMovedToReplied,
    promotedToLead,
    leadIds,
    clientPatches,
  };
}
