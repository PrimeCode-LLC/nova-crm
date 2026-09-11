import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import {
  shouldOpenReplyReview,
  stageIsBeforeReplied,
} from "@/lib/leads/reply-review";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead, PipelineStage } from "@/lib/types";
import type { ReplyActionCompletionOutcome } from "@/lib/leads/reply-action-completion-types";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/documents/tenant-write";
import { buildArchivePatch } from "@/lib/leads/lead-archive";
import { cancelLeadOutreachServer } from "@/lib/email/cancel-lead-outreach-server";
import { isReplyActionCloseLost } from "@/lib/email/reply-action-pending";
import type { ReplyClass, ReplyRecommendedAction } from "@/lib/email/reply-action-types";

export type { ReplyActionCompletionOutcome } from "@/lib/leads/reply-action-completion-types";

function relatedIds(lead: Lead): string[] {
  const ids = new Set<string>([lead.id]);
  const linked = lead.linkedSalesLeadId?.trim();
  const source = lead.prospectSourceId?.trim();
  if (linked) ids.add(linked);
  if (source) ids.add(source);
  return [...ids];
}

const emptyOutcome = (): ReplyActionCompletionOutcome => ({
  replyReviewResolved: false,
  stageMovedToReplied: false,
  promotedToLead: false,
  closedAsLost: false,
  markedDoNotContact: false,
  leadIds: [],
  clientPatches: [],
});

/**
 * After a reply-intelligence action is sent or accepted, clear the parallel
 * "reply review" pending state and apply the right pipeline outcome:
 * - positive/default → promote/move to Replied
 * - hard_no / close_lost → do-not-contact + Lost (no promote)
 */
export async function resolveReplyReviewAfterReplyActionServer(input: {
  organizationId: string;
  leadId: string;
  actorUid: string;
  /**
   * `completed` = send or confirm next step (accept review + stage outcome).
   * `suggestion_dismissed` = rejected AI suggestion; for hard_no also clears
   * the promote/move-to-Replied review so it cannot contradict the classification.
   */
  mode: "completed" | "suggestion_dismissed";
  classification?: ReplyClass;
  recommendedAction?: ReplyRecommendedAction;
}): Promise<ReplyActionCompletionOutcome> {
  const db = getAdminDb();
  if (!db) return emptyOutcome();

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists) return emptyOutcome();
  const raw = leadSnap.data() as Record<string, unknown>;
  if (String(raw.organizationId ?? "") !== input.organizationId) return emptyOutcome();

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
  const closeLost = isReplyActionCloseLost({
    classification: input.classification ?? primary.replyClass,
    recommendedAction: input.recommendedAction,
  });

  // Dismissing a hard-no suggestion must not leave a "Promote to lead" review behind.
  if (input.mode === "suggestion_dismissed") {
    if (!closeLost) return emptyOutcome();
    return dismissReplyReviewOnly({
      leadIds,
      leadById,
      now,
    });
  }

  const anyNeedsReview = [...leadById.values()].some(
    (row) => row.replyReviewStatus === "pending" && shouldOpenReplyReview(row),
  );

  // Even without replyReviewStatus, early-stage / prospect after a human reply
  // should land on Replied (or Lost for hard no) when the rep completes RI.
  const shouldPromoteOrMove =
    shouldOpenReplyReview(primary) ||
    primary.intakeKind === "prospect" ||
    stageIsBeforeReplied(primary.stage) ||
    closeLost;

  if (!anyNeedsReview && !shouldPromoteOrMove && !closeLost) {
    return emptyOutcome();
  }

  if (closeLost) {
    return applyCloseLostCompletion({
      organizationId: input.organizationId,
      actorUid: input.actorUid,
      leadIds,
      leadById,
      now,
    });
  }

  return applyPromoteOrRepliedCompletion({
    organizationId: input.organizationId,
    actorUid: input.actorUid,
    leadIds,
    leadById,
    primary,
    now,
  });
}

async function dismissReplyReviewOnly(input: {
  leadIds: string[];
  leadById: Map<string, Lead>;
  now: string;
}): Promise<ReplyActionCompletionOutcome> {
  const db = getAdminDb();
  if (!db) return emptyOutcome();

  const clientPatches: Array<{ leadId: string; patch: Partial<Lead> }> = [];
  let resolved = false;

  for (const id of input.leadIds) {
    const row = input.leadById.get(id);
    if (!row || row.replyReviewStatus !== "pending") continue;
    await db.collection(COLLECTIONS.leads).doc(id).set(
      {
        replyReviewStatus: "dismissed",
        lastActivityAt: input.now,
        updatedAt: input.now,
      },
      { merge: true },
    );
    clientPatches.push({
      leadId: id,
      patch: { replyReviewStatus: "dismissed", lastActivityAt: input.now },
    });
    resolved = true;
  }

  if (!resolved) return emptyOutcome();
  return {
    replyReviewResolved: true,
    stageMovedToReplied: false,
    promotedToLead: false,
    closedAsLost: false,
    markedDoNotContact: false,
    leadIds: input.leadIds,
    clientPatches,
  };
}

async function applyCloseLostCompletion(input: {
  organizationId: string;
  actorUid: string;
  leadIds: string[];
  leadById: Map<string, Lead>;
  now: string;
}): Promise<ReplyActionCompletionOutcome> {
  const db = getAdminDb();
  if (!db) return emptyOutcome();

  const clientPatches: Array<{ leadId: string; patch: Partial<Lead> }> = [];
  let closedAsLost = false;
  let markedDoNotContact = false;
  const archivePatch = buildArchivePatch({
    actorId: input.actorUid,
    reason: "lost",
    now: input.now,
  });

  for (const id of input.leadIds) {
    const row = input.leadById.get(id);
    if (!row) continue;

    const patch: Record<string, unknown> = {
      replyReviewStatus: "accepted",
      doNotContact: true,
      temperature: "cold",
      nextAction: "Do not contact — closed as lost (hard no / unsubscribe)",
      lastActivityAt: input.now,
      updatedAt: input.now,
    };
    const clientPatch: Partial<Lead> = {
      replyReviewStatus: "accepted",
      doNotContact: true,
      temperature: "cold",
      nextAction: "Do not contact — closed as lost (hard no / unsubscribe)",
      lastActivityAt: input.now,
    };
    markedDoNotContact = true;

    const shouldMoveStage = row.stage !== "lost" && row.stage !== "won";
    if (shouldMoveStage) {
      patch.stage = "lost" satisfies PipelineStage;
      clientPatch.stage = "lost";
      closedAsLost = true;
      if (!row.archivedAt?.trim()) {
        Object.assign(patch, archivePatch);
        Object.assign(clientPatch, archivePatch);
      }
    }

    await db.collection(COLLECTIONS.leads).doc(id).set(patch, { merge: true });
    clientPatches.push({ leadId: id, patch: clientPatch });

    const hardNoEmailFromLead =
      typeof (row as { email?: string }).email === "string"
        ? String((row as { email?: string }).email).trim()
        : "";
    let hardNoEmail = hardNoEmailFromLead;
    if (!hardNoEmail.includes("@") && row.contactId?.trim()) {
      try {
        const contactSnap = await db
          .collection(COLLECTIONS.contacts)
          .doc(row.contactId.trim())
          .get();
        const contactEmail =
          typeof contactSnap.data()?.email === "string"
            ? String(contactSnap.data()?.email).trim()
            : "";
        if (contactEmail.includes("@")) hardNoEmail = contactEmail;
      } catch {
        // best-effort suppression only
      }
    }
    if (hardNoEmail.includes("@")) {
      void import("@/lib/email/suppression-server").then(({ addSuppression }) =>
        addSuppression({
          organizationId: input.organizationId,
          email: hardNoEmail,
          reason: "unsubscribe",
          source: "hard_no",
          leadId: id,
          createdBy: input.actorUid,
        }),
      );
    }

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
              summary: `Moved from ${row.stage} → lost (hard no / unsubscribe)`,
              payload: {
                source: "reply_intelligence",
                previousStage: row.stage,
                nextStage: "lost",
                reason: "hard_no_close_lost",
                doNotContact: true,
              },
              createdAt: input.now,
            },
            input.actorUid,
          ),
        );
      } catch {
        /* timeline best-effort */
      }
    }
  }

  // Stop further outreach on the primary row (and linked ids).
  for (const id of input.leadIds) {
    try {
      await cancelLeadOutreachServer({
        organizationId: input.organizationId,
        leadId: id,
        userId: input.actorUid,
        reason: "Hard no / unsubscribe — do not contact",
      });
    } catch {
      /* outreach cancel best-effort */
    }
  }

  return {
    replyReviewResolved: true,
    stageMovedToReplied: false,
    promotedToLead: false,
    closedAsLost,
    markedDoNotContact,
    leadIds: input.leadIds,
    clientPatches,
  };
}

async function applyPromoteOrRepliedCompletion(input: {
  organizationId: string;
  actorUid: string;
  leadIds: string[];
  leadById: Map<string, Lead>;
  primary: Lead;
  now: string;
}): Promise<ReplyActionCompletionOutcome> {
  const db = getAdminDb();
  if (!db) return emptyOutcome();

  let stageMovedToReplied = false;
  let promotedToLead = false;
  const clientPatches: Array<{ leadId: string; patch: Partial<Lead> }> = [];

  const isProspect = isProspectRow(input.primary);
  const linkedSalesLeadId = input.primary.linkedSalesLeadId?.trim() || "";

  for (const id of input.leadIds) {
    const row = input.leadById.get(id);
    if (!row) continue;

    const patch: Record<string, unknown> = {
      replyReviewStatus: "accepted",
      lastActivityAt: input.now,
      updatedAt: input.now,
      temperature: "warm",
    };
    const clientPatch: Partial<Lead> = {
      replyReviewStatus: "accepted",
      lastActivityAt: input.now,
      temperature: "warm",
    };

    // Promote prospect → sales lead when this is the prospect row without a linked sales lead.
    if (isProspect && !linkedSalesLeadId && id === input.primary.id && row.intakeKind === "prospect") {
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
              createdAt: input.now,
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
    closedAsLost: false,
    markedDoNotContact: false,
    leadIds: input.leadIds,
    clientPatches,
  };
}
