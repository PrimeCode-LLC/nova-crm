import type { ChannelKey } from "@/lib/types";
import {
  emptyProspectForm,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";

export type NewProspectFormDraft = ProspectFormValues;

export function emptyNewProspectFormDraft(): NewProspectFormDraft {
  return emptyProspectForm();
}

export function mergePrefillIntoDraft(
  draft: NewProspectFormDraft,
  prefill?: {
    leadNotes?: string;
    channel?: ChannelKey;
    painPoints?: string;
    strategyId?: string;
    strategyAssignmentId?: string;
    strategyVersion?: number;
    personaId?: string;
  },
): NewProspectFormDraft {
  if (!prefill) return draft;
  return {
    ...draft,
    strategyId: draft.strategyId || prefill.strategyId || "",
    personaId: draft.personaId || prefill.personaId || "",
    strategyAssignmentId: draft.strategyAssignmentId || prefill.strategyAssignmentId || "",
    strategyVersion: draft.strategyVersion ?? prefill.strategyVersion,
    channel: draft.channel === "cold_email" && prefill.channel ? prefill.channel : draft.channel,
    leadNotes: draft.leadNotes.trim() ? draft.leadNotes : prefill.leadNotes ?? draft.leadNotes,
    painPoints: draft.painPoints.trim() ? draft.painPoints : prefill.painPoints ?? draft.painPoints,
  };
}
