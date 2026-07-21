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

const PROSPECT_ONLY_PATCH_KEYS = new Set([
  "intakeKind",
  "prospectOwnerId",
  "prospectVisibility",
  "prospectChannelAssignments",
  "prospectAssigneeIds",
  "linkedSalesLeadId",
]);

/** Fields on shared sales leads that channel push manages — do not overwrite from prospect edits. */
const SALES_LEAD_PUSH_MANAGED_PATCH_KEYS = new Set([
  "channelTags",
  "sharedOwnerIds",
  "prospectSourceId",
]);

/** Subset of a prospect patch that should propagate to its linked sales lead. */
export function prospectPatchForSalesLeadSync(patch: Partial<Lead>): Partial<Lead> {
  const out: Partial<Lead> = {};
  for (const key of Object.keys(patch) as (keyof Lead)[]) {
    if (PROSPECT_ONLY_PATCH_KEYS.has(key)) continue;
    if (SALES_LEAD_PUSH_MANAGED_PATCH_KEYS.has(key)) continue;
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
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

/**
 * Same hierarchy scope as sales leads: owner, managers up the org chart, plus channel
 * assignees and shared owners. Owners, admins, and directors see all.
 * `prospectVisibility` only tracks channel-assignment state — not org-wide read access.
 */
export function prospectVisibleToViewer(
  prospect: Lead,
  viewer: User,
  orgUsers: readonly User[],
): boolean {
  if (!isProspectRow(prospect)) return true;

  if (seesAllLeadsInTenant(viewer)) return true;

  const assigneeIds = prospect.prospectAssigneeIds?.length
    ? prospect.prospectAssigneeIds
    : prospectAssigneeIdsFromAssignments(prospect.prospectChannelAssignments);

  if (assigneeIds.includes(viewer.id)) return true;

  if (salesLeadVisibleViaSharedOwnership(prospect, viewer.id)) return true;

  const ownerId = prospectOwnerIdOf(prospect);
  if (!ownerId) return false;

  if (viewer.id === ownerId) return true;
  if (viewerManagesProspectOwner(viewer, prospect, orgUsers)) return true;

  if (viewer.roleId === "data_scraper" || viewer.roleId === "prospecting") {
    return prospect.scraperId === viewer.id;
  }

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
