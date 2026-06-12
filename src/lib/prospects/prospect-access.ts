import type { Lead, OrgMemberRole, ProspectChannelAssignment, User } from "@/lib/types";
import { seesAllLeadsInTenant } from "@/lib/workspace-hierarchy";

/** Direct + indirect managers of `userId` from Admin → Hierarchy (reporting line only). */
function managerAncestorIdsOf(userId: string, orgUsers: readonly User[]): string[] {
  const byId = new Map(orgUsers.map((u) => [u.id, u]));
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let mid = byId.get(userId)?.managerId;
  while (mid && !seen.has(mid)) {
    seen.add(mid);
    ancestors.push(mid);
    mid = byId.get(mid)?.managerId;
  }
  return ancestors;
}

/** True when `viewer` is above the prospect creator in the org chart. */
export function viewerManagesProspectOwner(
  viewer: User,
  prospect: Lead,
  orgUsers: readonly User[],
): boolean {
  const ownerId = prospectOwnerIdOf(prospect);
  if (!ownerId) return false;
  return managerAncestorIdsOf(ownerId, orgUsers).includes(viewer.id);
}

export function prospectOwnerIdOf(prospect: Lead): string {
  return (
    prospect.prospectOwnerId?.trim() ||
    prospect.createdById?.trim() ||
    prospect.ownerId?.trim() ||
    ""
  );
}

export function prospectAssigneeIdsFromAssignments(
  assignments: ProspectChannelAssignment[] | undefined,
): string[] {
  if (!assignments?.length) return [];
  return [...new Set(assignments.map((a) => a.assigneeId).filter(Boolean))];
}

export function isProspectRow(lead: Lead): boolean {
  return lead.intakeKind === "prospect";
}

export function isProspectDerivedSalesLead(lead: Lead): boolean {
  return Boolean(lead.prospectSourceId?.trim());
}

/** Admin-only edit/delete for leads created from prospect channel pushes. */
export function canEditProspectDerivedLead(
  lead: Lead,
  viewerOrgRole: OrgMemberRole | undefined,
): boolean {
  if (!isProspectDerivedSalesLead(lead)) return true;
  return viewerOrgRole === "owner" || viewerOrgRole === "admin";
}

export function canManageProspectChannels(
  viewer: User | undefined,
  prospect: Lead,
  orgUsers: readonly User[],
): boolean {
  if (!viewer?.id?.trim() || !isProspectRow(prospect)) return false;
  const ownerId = prospectOwnerIdOf(prospect);
  if (ownerId && viewer.id === ownerId) return true;
  return viewerManagesProspectOwner(viewer, prospect, orgUsers);
}

export function canPushProspectChannel(
  viewerId: string | undefined,
  prospect: Lead,
  assignmentId: string,
): boolean {
  if (!viewerId?.trim() || !isProspectRow(prospect)) return false;
  const assignment = prospect.prospectChannelAssignments?.find((a) => a.id === assignmentId);
  if (!assignment || assignment.pushedAt) return false;
  return assignment.assigneeId === viewerId;
}

export function prospectVisibleToViewer(
  prospect: Lead,
  viewer: User,
  orgUsers: readonly User[],
): boolean {
  if (!isProspectRow(prospect)) return true;

  const visibility = prospect.prospectVisibility ?? "open";
  const hasAssignments = (prospect.prospectChannelAssignments?.length ?? 0) > 0;

  if (visibility === "open" && !hasAssignments) return true;

  if (seesAllLeadsInTenant(viewer)) return true;

  const ownerId = prospectOwnerIdOf(prospect);
  if (ownerId && viewer.id === ownerId) return true;

  if (viewerManagesProspectOwner(viewer, prospect, orgUsers)) return true;

  const assigneeIds = prospect.prospectAssigneeIds?.length
    ? prospect.prospectAssigneeIds
    : prospectAssigneeIdsFromAssignments(prospect.prospectChannelAssignments);

  if (assigneeIds.includes(viewer.id)) return true;

  return false;
}

export function salesLeadVisibleViaSharedOwnership(lead: Lead, viewerId: string): boolean {
  return Boolean(lead.sharedOwnerIds?.includes(viewerId));
}

export function assignmentForViewer(
  prospect: Lead,
  viewerId: string,
): ProspectChannelAssignment | undefined {
  return prospect.prospectChannelAssignments?.find(
    (a) => a.assigneeId === viewerId && !a.pushedAt,
  );
}

export function unpushedAssignmentsForViewer(
  prospect: Lead,
  viewerId: string,
): ProspectChannelAssignment[] {
  return (
    prospect.prospectChannelAssignments?.filter(
      (a) => a.assigneeId === viewerId && !a.pushedAt,
    ) ?? []
  );
}
