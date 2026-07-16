import type { Followup, Lead, User } from "@/lib/types";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";

/** Lead owner, followup owner, or elevated workspace role may edit/delete. */
export function canMutateFollowup(input: {
  currentUserId: string;
  viewer: User | undefined;
  lead: Lead | undefined;
  followup: Followup;
}): boolean {
  if (!input.currentUserId) return false;
  if (viewerHasElevatedWorkspaceRole(input.viewer)) return true;
  if (input.followup.ownerId === input.currentUserId) return true;
  if (input.lead?.ownerId === input.currentUserId) return true;
  return false;
}
