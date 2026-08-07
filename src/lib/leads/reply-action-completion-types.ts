import type { Lead } from "@/lib/types";

export type ReplyActionCompletionOutcome = {
  replyReviewResolved: boolean;
  stageMovedToReplied: boolean;
  promotedToLead: boolean;
  /** Hard no / unsubscribe: closed as Lost instead of Replied. */
  closedAsLost: boolean;
  markedDoNotContact: boolean;
  /** Lead ids that received denorm patches (viewed + linked). */
  leadIds: string[];
  /** Patches the client should hydrate into session (no secrets). */
  clientPatches: Array<{ leadId: string; patch: Partial<Lead> }>;
};
