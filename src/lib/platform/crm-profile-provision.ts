import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  resolveRoleForUser,
  writeComputedPermissions,
} from "@/lib/permissions/roles-server";
import {
  defaultCrmRoleIdForOrgRole,
  shouldUpgradeCrmRoleOnBackfill,
} from "@/lib/platform/crm-role-defaults";
import type { OrgMemberRole, Role } from "@/lib/types";

export { defaultCrmRoleIdForOrgRole, shouldUpgradeCrmRoleOnBackfill } from "@/lib/platform/crm-role-defaults";

function existingRoleId(existing: Record<string, unknown> | null): Role | undefined {
  const raw = existing?.roleId;
  return typeof raw === "string" && raw.trim() ? (raw as Role) : undefined;
}

export type CrmProfileProvisionInput = {
  uid: string;
  organizationId: string;
  orgRole: OrgMemberRole;
  email?: string;
  displayName?: string;
  actorUid?: string;
};

export type CrmProfileProvisionOptions = {
  /** When true, upgrade owners stuck on salesperson and fill missing roleId values. */
  forceRoleSync?: boolean;
};

export type CrmProfileProvisionResult = {
  provisioned: boolean;
  roleId?: Role;
  reason?: "missing_role" | "upgraded_owner" | "already_set";
};

/**
 * Merge workspace membership fields and default CRM permissions onto `users/{uid}`.
 * Idempotent: skips when a CRM role is already assigned unless `forceRoleSync` applies.
 */
export async function provisionCrmProfileServer(
  db: Firestore,
  input: CrmProfileProvisionInput,
  options: CrmProfileProvisionOptions = {},
): Promise<CrmProfileProvisionResult> {
  const ref = db.collection(COLLECTIONS.users).doc(input.uid);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() ?? {}) : null;
  const currentRoleId = existingRoleId(existing);

  let assignRoleId: Role | undefined;
  let reason: CrmProfileProvisionResult["reason"];

  if (!currentRoleId) {
    assignRoleId = defaultCrmRoleIdForOrgRole(input.orgRole);
    reason = "missing_role";
  } else if (
    options.forceRoleSync &&
    shouldUpgradeCrmRoleOnBackfill(input.orgRole, currentRoleId)
  ) {
    assignRoleId = defaultCrmRoleIdForOrgRole(input.orgRole);
    reason = "upgraded_owner";
  } else {
    return { provisioned: false, roleId: currentRoleId, reason: "already_set" };
  }

  const payload: Record<string, unknown> = {
    organizationId: input.organizationId,
    orgRole: input.orgRole,
    roleId: assignRoleId,
    status: (existing?.status as string | undefined) ?? "active",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.email?.trim()) payload.email = input.email.trim().toLowerCase();
  if (input.displayName?.trim()) payload.displayName = input.displayName.trim();
  if (input.orgRole === "owner") payload.isSuperAdmin = true;

  await ref.set(payload, { merge: true });

  const roleDoc = await resolveRoleForUser({
    organizationId: input.organizationId,
    roleId: assignRoleId,
    actorUid: input.actorUid ?? input.uid,
  });
  await writeComputedPermissions({
    uid: input.uid,
    organizationId: input.organizationId,
    role: roleDoc,
  });

  return { provisioned: true, roleId: assignRoleId, reason };
}

/** Backfill CRM profiles for every active member in an organization. */
export async function backfillOrgCrmProfilesServer(
  db: Firestore,
  organizationId: string,
  members: Array<{
    uid: string;
    email: string;
    displayName?: string;
    role: OrgMemberRole;
    status: string;
  }>,
  options: { actorUid?: string; forceRoleSync?: boolean } = {},
): Promise<{
  total: number;
  provisioned: number;
  skipped: number;
  results: Array<CrmProfileProvisionResult & { uid: string }>;
}> {
  const active = members.filter((m) => m.status === "active");
  const results: Array<CrmProfileProvisionResult & { uid: string }> = [];
  let provisioned = 0;

  for (const member of active) {
    const result = await provisionCrmProfileServer(
      db,
      {
        uid: member.uid,
        organizationId,
        orgRole: member.role,
        email: member.email,
        displayName: member.displayName,
        actorUid: options.actorUid,
      },
      { forceRoleSync: options.forceRoleSync ?? true },
    );
    results.push({ uid: member.uid, ...result });
    if (result.provisioned) provisioned += 1;
  }

  return {
    total: active.length,
    provisioned,
    skipped: active.length - provisioned,
    results,
  };
}
