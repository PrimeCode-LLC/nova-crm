"use client";

import { toast } from "sonner";
import type { Lead, PipelineStage } from "@/lib/types";
import {
  buildDismissReplyReviewPatch,
  hasPendingReplyReview,
  replyReviewActionFor,
  stageIsBeforeReplied,
} from "@/lib/leads/reply-review";

type PatchLeadAsync = (leadId: string, patch: Partial<Lead>) => Promise<void>;
type UpdateLeadStage = (
  leadId: string,
  nextStage: PipelineStage,
  previousStage: PipelineStage,
  actorId: string,
) => void;

/**
 * One-click accept for the reply review prompt:
 * - Prospect without linked sales lead → promote to sales lead + stage `replied`
 * - Prospect with linked sales lead → accept review + move linked lead to `replied`
 * - Early-stage sales lead → move to `replied`
 */
export async function acceptLeadReplyReview(input: {
  lead: Lead;
  leads: readonly Lead[];
  actorId: string;
  patchLeadAsync: PatchLeadAsync;
  updateLeadStage: UpdateLeadStage;
}): Promise<{ targetLeadId: string; promoted: boolean }> {
  const { lead, actorId, patchLeadAsync, updateLeadStage } = input;
  if (!hasPendingReplyReview(lead)) {
    throw new Error("No pending reply review on this lead");
  }

  const now = new Date().toISOString();
  const action = replyReviewActionFor(lead);
  const linkedSalesLeadId = lead.linkedSalesLeadId?.trim() || "";

  if (action === "promote_to_lead" && linkedSalesLeadId) {
    const salesLead = input.leads.find((row) => row.id === linkedSalesLeadId);
    await patchLeadAsync(lead.id, {
      replyReviewStatus: "accepted",
      lastActivityAt: now,
      temperature: "warm",
    });
    if (salesLead) {
      await patchLeadAsync(salesLead.id, {
        replyReviewStatus: "accepted",
        lastActivityAt: now,
        temperature: "warm",
      });
    }
    if (lead.stage !== "replied") {
      // Stage syncs to the linked sales lead from the prospect write path.
      updateLeadStage(lead.id, "replied", lead.stage, actorId);
    } else if (
      salesLead &&
      salesLead.stage !== "replied" &&
      stageIsBeforeReplied(salesLead.stage)
    ) {
      updateLeadStage(salesLead.id, "replied", salesLead.stage, actorId);
    }
    toast.success("Moved opportunity to Replied");
    return { targetLeadId: linkedSalesLeadId, promoted: false };
  }

  if (action === "promote_to_lead") {
    const previousStage = lead.stage;
    const ownerPatch =
      !lead.ownerId?.trim() && actorId ? { ownerId: actorId } : {};
    await patchLeadAsync(lead.id, {
      intakeKind: undefined,
      replyReviewStatus: "accepted",
      lastActivityAt: now,
      temperature: "warm",
      ...ownerPatch,
    });
    if (previousStage !== "replied") {
      updateLeadStage(lead.id, "replied", previousStage, actorId);
    }
    toast.success("Promoted to lead at Replied");
    return { targetLeadId: lead.id, promoted: true };
  }

  await patchLeadAsync(lead.id, {
    replyReviewStatus: "accepted",
    lastActivityAt: now,
    temperature: "warm",
  });
  if (lead.stage !== "replied" && stageIsBeforeReplied(lead.stage)) {
    updateLeadStage(lead.id, "replied", lead.stage, actorId);
  }
  toast.success("Moved to Replied");
  return { targetLeadId: lead.id, promoted: false };
}

export async function dismissLeadReplyReview(input: {
  lead: Lead;
  patchLeadAsync: PatchLeadAsync;
}): Promise<void> {
  if (input.lead.replyReviewStatus !== "pending") return;
  await input.patchLeadAsync(input.lead.id, buildDismissReplyReviewPatch());
  toast.message("Reply review dismissed");
}
