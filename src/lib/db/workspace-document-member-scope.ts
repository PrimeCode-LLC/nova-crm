import { seesAllCrmInTenant } from "@/lib/workspace-hierarchy";

/**
 * Server-side member scope for workspace document collections that carry
 * owner / assignee fields. Org owner, org admin, CRM director, and super-admin
 * see the tenant. Everyone else is limited to rows they own or manage.
 */

export const MEMBER_SCOPED_WORKSPACE_COLLECTIONS = new Set([
  "followups",
  "followupPlans",
  "leadTasks",
]);

export function workspaceDocSeesAll(input: {
  orgRole?: string | null;
  roleId?: string | null;
  isSuperAdmin?: boolean;
}): boolean {
  return seesAllCrmInTenant(input);
}

export type MemberDocSlice =
  | { kind: "eq"; field: string; value: string }
  | { kind: "array-contains"; field: string; value: string };

/** Query slices that together match the Firestore owner-or-manager listeners. */
export function memberWorkspaceDocSlices(collection: string, uid: string): MemberDocSlice[] {
  if (collection === "leadTasks") {
    return [
      { kind: "eq", field: "assigneeId", value: uid },
      { kind: "eq", field: "createdById", value: uid },
    ];
  }
  return [
    { kind: "eq", field: "ownerId", value: uid },
    { kind: "array-contains", field: "ownerManagerIds", value: uid },
  ];
}

export function memberCanAccessWorkspaceDoc(
  collection: string,
  payload: Record<string, unknown>,
  uid: string,
): boolean {
  if (collection === "leadTasks") {
    return payload.assigneeId === uid || payload.createdById === uid;
  }
  if (payload.ownerId === uid) return true;
  const managers = payload.ownerManagerIds;
  return Array.isArray(managers) && managers.includes(uid);
}
