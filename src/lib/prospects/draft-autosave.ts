import type { ProspectDraftFieldKey } from "./draft-types";

/**
 * A save may only acknowledge the edit generation it captured. If the user
 * changed anything while the request was in flight, retain the dirty keys.
 */
export function reviewedKeysAfterDraftSave(
  current: Set<ProspectDraftFieldKey>,
  capturedEditVersion: number,
  currentEditVersion: number,
): Set<ProspectDraftFieldKey> {
  return capturedEditVersion === currentEditVersion ? new Set() : new Set(current);
}
