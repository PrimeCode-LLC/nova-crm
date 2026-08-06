import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead, LeadIntakeKind } from "@/lib/types";

export type LeadArchiveReason = "manual" | "lost" | "rejected";

export function isLeadArchived(lead: Pick<Lead, "archivedAt">): boolean {
  return Boolean(lead.archivedAt?.trim());
}

export function filterActiveLeads<T extends Pick<Lead, "archivedAt">>(leads: readonly T[]): T[] {
  return leads.filter((l) => !isLeadArchived(l));
}

export function filterArchivedLeads<T extends Pick<Lead, "archivedAt">>(leads: readonly T[]): T[] {
  return leads.filter((l) => isLeadArchived(l));
}

/** Patch to soft-archive a lead/prospect (same document). */
export function buildArchivePatch(input: {
  actorId: string;
  reason?: LeadArchiveReason;
  now?: string;
}): Partial<Lead> {
  const now = input.now ?? new Date().toISOString();
  return {
    archivedAt: now,
    archivedBy: input.actorId,
    archiveReason: input.reason ?? "manual",
    lastActivityAt: now,
  };
}

/**
 * Clears archive fields. Pass `undefined` so Firestore `persistLeadPatchClient`
 * deletes the keys from the document.
 */
export function buildRestorePatch(input?: { now?: string }): Partial<Lead> {
  const now = input?.now ?? new Date().toISOString();
  return {
    archivedAt: undefined,
    archivedBy: undefined,
    archiveReason: undefined,
    lastActivityAt: now,
  };
}

/**
 * Restore into Prospects: clear archive and ensure `intakeKind === "prospect"`.
 * Used from Archive as a salvage path (including Lost), bypassing move-back stage gates.
 */
export function buildRestoreAsProspectPatch(input?: { now?: string }): Partial<Lead> {
  return {
    ...buildRestorePatch(input),
    intakeKind: "prospect" satisfies LeadIntakeKind,
  };
}

/** Where a restored row should land in the UI. */
export function archiveHomeLabel(lead: Pick<Lead, "intakeKind">): "Leads" | "Prospects" {
  return isProspectRow(lead as Lead) ? "Prospects" : "Leads";
}
