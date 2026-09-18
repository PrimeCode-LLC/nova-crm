import type { OrgMemberRole } from "@/lib/types";

/**
 * Server-side narrow scope for CRM list/count APIs.
 * Members are always narrowed; admins/owners only when `narrow=1` is requested.
 * Ignores client `narrow=0` for members (tenant isolation).
 */
export function resolveCrmListNarrowToMember(
  orgRole: OrgMemberRole,
  narrowParam: string | null,
): boolean {
  const seesAll = orgRole === "owner" || orgRole === "admin";
  if (!seesAll) return true;
  return narrowParam === "1";
}
