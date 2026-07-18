import type { CrmLabel, Lead } from "@/lib/types";
import type { IntentPlaybook } from "@/lib/intent/types";
import {
  buildQualityLeadPatch,
  patchTouchesQualityFields,
} from "@/lib/intent/compute-quality-score";

/** Resolve CRM label display names for a lead. */
export function labelNamesForLead(
  lead: Pick<Lead, "labelIds">,
  crmLabels: readonly CrmLabel[],
): string[] {
  const ids = lead.labelIds ?? [];
  if (!ids.length) return [];
  const byId = new Map(crmLabels.map((l) => [l.id, l.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
}

/**
 * Merge Quality Score fields into a lead patch when research/labels/engagement change.
 * Returns the original patch unchanged when scoring is not needed.
 */
export function withQualityScorePatch(
  current: Lead,
  patch: Partial<Lead>,
  playbook: IntentPlaybook,
  crmLabels: readonly CrmLabel[],
): Partial<Lead> {
  if (!patchTouchesQualityFields(patch)) return patch;

  const merged: Lead = { ...current, ...patch };
  const names = labelNamesForLead(merged, crmLabels);
  const qualityPatch = buildQualityLeadPatch(merged, playbook, names);
  return { ...patch, ...qualityPatch };
}

/** Attach initial quality fields when creating a lead. */
export function withInitialQualityScore(
  lead: Lead,
  playbook: IntentPlaybook,
  crmLabels: readonly CrmLabel[],
): Lead {
  const names = labelNamesForLead(lead, crmLabels);
  const qualityPatch = buildQualityLeadPatch(lead, playbook, names);
  return { ...lead, ...qualityPatch };
}
