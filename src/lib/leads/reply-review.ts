import { PIPELINE_STAGES } from "@/lib/constants";
import type { Lead, PipelineStage } from "@/lib/types";
import { isProspectRow } from "@/lib/prospects/prospect-access";

export type ReplyReviewAction = "promote_to_lead" | "move_to_replied" | "none";

export type ReplyReviewSource = NonNullable<Lead["lastReplySource"]>;

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

export function stageIsBeforeReplied(stage: PipelineStage): boolean {
  const index = STAGE_ORDER.indexOf(stage);
  const repliedIndex = STAGE_ORDER.indexOf("replied");
  return index >= 0 && repliedIndex >= 0 && index < repliedIndex;
}

/** Whether a reply should open (or re-open) the dashboard/detail promote prompt. */
export function shouldOpenReplyReview(lead: Pick<Lead, "intakeKind" | "stage">): boolean {
  if (["won", "lost"].includes(lead.stage)) return false;
  if (lead.intakeKind === "prospect") return true;
  return stageIsBeforeReplied(lead.stage);
}

export function hasPendingReplyReview(lead: Lead): boolean {
  if (lead.replyReviewStatus !== "pending") return false;
  return shouldOpenReplyReview(lead);
}

export function replyReviewActionFor(lead: Lead): ReplyReviewAction {
  if (!hasPendingReplyReview(lead)) return "none";
  if (isProspectRow(lead)) return "promote_to_lead";
  return "move_to_replied";
}

export function replyReviewActionLabel(action: ReplyReviewAction, lead: Lead): string {
  if (action === "promote_to_lead") {
    return lead.linkedSalesLeadId?.trim()
      ? "Move opportunity to Replied"
      : "Promote to lead · Replied";
  }
  if (action === "move_to_replied") return "Move to Replied";
  return "";
}

export function replyReviewDetail(lead: Lead): string {
  if (isProspectRow(lead)) {
    return lead.linkedSalesLeadId?.trim()
      ? "Reply received on a prospect that already has a sales lead - confirm moving it to Replied."
      : "Reply received - promote this prospect into the sales pipeline at Replied.";
  }
  return "Reply received - confirm moving this opportunity to Replied.";
}

/** Patch applied when an inbound reply is detected. */
export function buildReplyDetectedPatch(input: {
  lead: Pick<Lead, "intakeKind" | "stage">;
  replyAt: string;
  replyMessageId?: string;
  source: ReplyReviewSource;
}): Partial<Lead> {
  const patch: Partial<Lead> = {
    lastReplyAt: input.replyAt,
    lastReplySource: input.source,
    lastActivityAt: input.replyAt,
    temperature: "warm",
  };
  if (input.replyMessageId) patch.lastReplyMessageId = input.replyMessageId;
  if (shouldOpenReplyReview(input.lead)) {
    patch.replyReviewStatus = "pending";
  }
  return patch;
}

export function buildDismissReplyReviewPatch(): Partial<Lead> {
  return { replyReviewStatus: "dismissed" };
}

export function listPendingReplyReviews(leads: readonly Lead[]): Lead[] {
  return leads
    .filter(hasPendingReplyReview)
    .sort((a, b) => {
      const aTime = a.lastReplyAt ? new Date(a.lastReplyAt).getTime() : 0;
      const bTime = b.lastReplyAt ? new Date(b.lastReplyAt).getTime() : 0;
      return bTime - aTime;
    });
}
