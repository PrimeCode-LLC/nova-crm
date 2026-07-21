import type { ChannelKey } from "@/lib/types";
import {
  emptyProspectForm,
  emptyProspectQualifyForm,
  parseProspectForm,
  PROSPECT_FORM_VERSION,
  type ProspectFormValues,
  type ProspectQualifyFormState,
} from "@/lib/prospects/prospect-form";

export const NEW_PROSPECT_DRAFT_VERSION = PROSPECT_FORM_VERSION;
export const PENDING_PROSPECT_DRAFT_ID = "pending";
export type NewProspectFormDraft = ProspectFormValues;
export type LocalProspectDraftRecovery = {
  form: NewProspectFormDraft;
  revision?: number;
  savedAt: string;
};

export function emptyNewProspectFormDraft(): NewProspectFormDraft {
  return emptyProspectForm();
}

/** Keep offline recovery isolated between launcher contexts before a server id exists. */
export function pendingProspectDraftId(launch?: {
  source?: string;
  destination?: string;
  prefill?: unknown;
}): string {
  if (!launch?.source) return PENDING_PROSPECT_DRAFT_ID;
  const input = JSON.stringify([launch.destination ?? "", launch.prefill ?? null]);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const source = launch.source.replace(/[^a-z0-9_-]/gi, "_");
  return `pending-${source}-${(hash >>> 0).toString(36)}`;
}

/** Legacy shared session key retained solely for one-time migration. */
export function legacyDraftStorageKey(userId: string | undefined): string | null {
  if (!userId?.trim()) return null;
  return `crm:new-prospect-draft:v${NEW_PROSPECT_DRAFT_VERSION}:${userId.trim()}`;
}

function previousLegacyDraftStorageKey(userId: string | undefined): string | null {
  if (!userId?.trim()) return null;
  return `crm:new-prospect-draft:v1:${userId.trim()}`;
}

export function draftStorageKey(
  userId: string | undefined,
  draftId?: string,
): string | null {
  const legacy = legacyDraftStorageKey(userId);
  if (!legacy) return null;
  return draftId ? `${legacy}:draft:${draftId}` : legacy;
}

export function parseLocalProspectDraftRecovery(raw: string): LocalProspectDraftRecovery | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const isEnvelope = Boolean(parsed && typeof parsed === "object" && "form" in parsed);
    const envelope = isEnvelope
      ? (parsed as Partial<LocalProspectDraftRecovery>)
      : { savedAt: "", revision: undefined };
    const rawForm: unknown = isEnvelope
      ? (parsed as { form?: unknown }).form
      : parsed;
    const candidate =
      rawForm &&
      typeof rawForm === "object" &&
      "v" in rawForm &&
      rawForm.v === 1
        ? { ...rawForm, v: NEW_PROSPECT_DRAFT_VERSION }
        : rawForm;
    const form = parseProspectForm(candidate);
    if (!form) return null;
    return {
      form,
      revision:
        typeof envelope.revision === "number" &&
        Number.isSafeInteger(envelope.revision) &&
        envelope.revision >= 0
          ? envelope.revision
          : undefined,
      savedAt: typeof envelope.savedAt === "string" ? envelope.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function loadNewProspectDraft(
  userId: string | undefined,
  draftId?: string,
): LocalProspectDraftRecovery | null {
  const key = draftStorageKey(userId, draftId);
  if (!key) return null;
  try {
    const storage = draftId ? localStorage : sessionStorage;
    const raw =
      storage.getItem(key) ??
      (!draftId
        ? storage.getItem(previousLegacyDraftStorageKey(userId) ?? "")
        : null);
    return raw ? parseLocalProspectDraftRecovery(raw) : null;
  } catch {
    return null;
  }
}

export function saveNewProspectDraft(
  userId: string | undefined,
  draftId: string,
  draft: NewProspectFormDraft,
  revision?: number,
): void {
  const key = draftStorageKey(userId, draftId);
  if (!key || typeof localStorage === "undefined") return;
  try {
    const recovery: LocalProspectDraftRecovery = {
      form: draft,
      revision,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(recovery));
  } catch {
    /* quota / private mode */
  }
}

export function clearNewProspectDraft(
  userId: string | undefined,
  draftId?: string,
): void {
  const key = draftStorageKey(userId, draftId);
  if (!key) return;
  try {
    (draftId ? localStorage : sessionStorage).removeItem(key);
    if (!draftId) {
      const previousKey = previousLegacyDraftStorageKey(userId);
      if (previousKey) sessionStorage.removeItem(previousKey);
    }
  } catch {
    /* ignore */
  }
}

/** Move the old shared session value only after a server draft exists. */
export function acknowledgeLegacyDraftMigration(
  userId: string | undefined,
  draftId: string,
  draft: NewProspectFormDraft,
  revision: number,
): void {
  saveNewProspectDraft(userId, draftId, draft, revision);
  clearNewProspectDraft(userId);
  clearNewProspectDraft(userId, PENDING_PROSPECT_DRAFT_ID);
}

export function serializeNewProspectDraft(draft: NewProspectFormDraft): string {
  return JSON.stringify(draft);
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

function qualifyIsEmpty(q: ProspectQualifyFormState): boolean {
  const empty = emptyProspectQualifyForm();
  if (q.primaryOpportunityLabel.trim()) return false;
  if (q.rejectionNote.trim()) return false;
  if (q.rejectionReason) return false;
  if (q.deeplyPersonalized) return false;
  if (q.qualifyStatus !== empty.qualifyStatus) return false;
  const evidenceEmpty = q.evidence.every(
    (row) =>
      !row.label.trim() &&
      !row.sourceUrl.trim() &&
      !row.category.trim() &&
      !row.explanation.trim() &&
      !row.observedAt.trim() &&
      !row.signalId,
  );
  if (!evidenceEmpty) return false;
  const p = q.personalization;
  if (
    p.trigger.trim() ||
    p.likelyImpact.trim() ||
    p.relevantService.trim() ||
    p.suggestedAngle.trim()
  ) {
    return false;
  }
  return true;
}

/** True when the draft matches an untouched new-prospect form. */
export function isNewProspectFormDraftEmpty(draft: NewProspectFormDraft): boolean {
  if (draft.strategyId || draft.personaId || draft.strategyAssignmentId) return false;
  if (draft.showAdvancedCompany) return false;
  if (!qualifyIsEmpty(draft.qualifyForm)) return false;

  const empty = emptyNewProspectFormDraft();
  const keys = Object.keys(empty) as (keyof NewProspectFormDraft)[];
  for (const key of keys) {
    if (key === "v" || key === "qualifyForm" || key === "strategyVersion") continue;
    if (draft[key] !== empty[key]) return false;
  }
  return true;
}
