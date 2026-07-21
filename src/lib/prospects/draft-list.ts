import type {
  ProspectDraft,
  ProspectDraftOrigin,
} from "@/lib/prospects/draft-types";

export type ProspectDraftReadiness = "all" | "ready" | "needs_review";
export type ProspectDraftSource = "all" | ProspectDraftOrigin;

export type ProspectDraftListFilters = {
  search: string;
  source: ProspectDraftSource;
  readiness: ProspectDraftReadiness;
};

export function prospectDraftTitle(draft: ProspectDraft): string {
  return draft.fields.companyName?.value || draft.form?.bizName || "Untitled company";
}

export function filterProspectDrafts(
  drafts: ProspectDraft[],
  filters: ProspectDraftListFilters,
): ProspectDraft[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return drafts.filter((draft) => {
    if (filters.source !== "all" && draft.origin !== filters.source) return false;
    if (filters.readiness === "ready" && draft.missingRequiredFields.length > 0) return false;
    if (filters.readiness === "needs_review" && draft.missingRequiredFields.length === 0) return false;
    if (!search) return true;
    const values = [
      prospectDraftTitle(draft),
      draft.fields.contactName?.value,
      draft.fields.contactEmail?.value,
      draft.fields.companyDomain?.value,
      draft.sourceContext,
    ];
    return values.some((value) => value?.toLocaleLowerCase().includes(search));
  });
}
