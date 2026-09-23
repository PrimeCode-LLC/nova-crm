import { getDocument } from "@/lib/db/document-shim/store";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { OrgMemberRole } from "@/lib/types";
import { seesAllCrmInTenant } from "@/lib/workspace-hierarchy";

/**
 * Server-side narrow scope for CRM list/count APIs.
 * Non-oversight members are always narrowed. Oversight roles narrow only when
 * `narrow=1` is requested. Client `narrow=0` cannot widen a member.
 */
export function resolveCrmListNarrowToMember(
  orgRole: OrgMemberRole,
  narrowParam: string | null,
  crmRole?: { roleId?: string | null; isSuperAdmin?: boolean },
): boolean {
  const seesAll = seesAllCrmInTenant({
    orgRole,
    roleId: crmRole?.roleId,
    isSuperAdmin: crmRole?.isSuperAdmin,
  });
  if (!seesAll) return true;
  return narrowParam === "1";
}

/** Load CRM role stamps when org role alone is not tenant-wide (directors). */
export async function resolveCrmListNarrowForSession(
  orgRole: OrgMemberRole,
  narrowParam: string | null,
  uid: string,
): Promise<boolean> {
  if (seesAllCrmInTenant({ orgRole })) {
    return narrowParam === "1";
  }
  const userDoc = await getDocument(`${COLLECTIONS.users}/${uid}`);
  const payload = userDoc?.payload ?? {};
  return resolveCrmListNarrowToMember(orgRole, narrowParam, {
    roleId: typeof payload.roleId === "string" ? payload.roleId : null,
    isSuperAdmin: payload.isSuperAdmin === true,
  });
}
