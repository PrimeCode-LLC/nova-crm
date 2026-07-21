import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordAudit } from "@/lib/firestore/audit";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import {
  buildOrgManagerAncestorIdsMap,
  managerAssignmentCreatesCycle,
} from "@/lib/user-hierarchy-tree";
import { normalizeFeatureGrants } from "@/lib/admin-feature-access";
import { GRANTABLE_ADMIN_FEATURES } from "@/lib/admin-features";
import {
  getOrgRole,
  resolveRoleForUser,
  writeComputedPermissions,
} from "@/lib/permissions/roles-server";
import type { Role, User } from "@/lib/types";

const CRM_STATUSES = ["active", "inactive", "pip"] as const;

const patchSchema = z
  .object({
    userId: z.string().min(1),
    managerId: z.union([z.string().min(1), z.null()]).optional(),
    departmentId: z.union([z.string().min(1), z.null()]).optional(),
    /** System preset id or custom org role document id. */
    roleId: z.string().min(1).max(80).optional(),
    status: z.enum(CRM_STATUSES).optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(320).optional(),
    title: z.union([z.string().trim().max(200), z.null()]).optional(),
    featureGrants: z
      .array(z.string())
      .optional()
      .refine(
        (arr) =>
          arr === undefined ||
          arr.every((k) => (GRANTABLE_ADMIN_FEATURES as readonly string[]).includes(k)),
        { message: "Invalid feature grant" },
      ),
  })
  .refine(
    (d) =>
      d.managerId !== undefined ||
      d.departmentId !== undefined ||
      d.roleId !== undefined ||
      d.status !== undefined ||
      d.displayName !== undefined ||
      d.email !== undefined ||
      d.title !== undefined ||
      d.featureGrants !== undefined,
    { message: "At least one field is required" },
  );

function asUserFromAdmin(id: string, raw: DocumentData): User {
  const r = raw as Record<string, unknown>;
  return {
    id,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? r.email ?? id),
    photoURL: typeof r.photoURL === "string" ? r.photoURL : undefined,
    roleId: (r.roleId as Role) ?? "salesperson",
    departmentId: typeof r.departmentId === "string" ? r.departmentId : undefined,
    managerId: typeof r.managerId === "string" ? r.managerId : undefined,
    title: typeof r.title === "string" ? r.title : undefined,
    isSuperAdmin: Boolean(r.isSuperAdmin),
    company: typeof r.company === "string" ? r.company : undefined,
    organizationId: typeof r.organizationId === "string" ? r.organizationId : undefined,
    orgRole: r.orgRole as User["orgRole"],
    featureGrants: normalizeFeatureGrants(r.featureGrants),
    status: (r.status as User["status"]) ?? "active",
    createdAt: firestoreValueToIso(r.createdAt),
  };
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured on this server." },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const actorSnap = await db.collection(COLLECTIONS.users).doc(g.ctx.session.uid).get();
  if (!actorSnap.exists) {
    return NextResponse.json({ error: "Actor profile not found" }, { status: 403 });
  }
  const actor = asUserFromAdmin(g.ctx.session.uid, actorSnap.data()!);
  if (!canManageOrgHierarchy(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    userId: targetId,
    managerId: bodyManagerId,
    departmentId: bodyDeptId,
    roleId: bodyRoleId,
    status: bodyStatus,
    displayName: bodyDisplayName,
    email: bodyEmail,
    title: bodyTitle,
    featureGrants: bodyFeatureGrants,
  } = parsed.data;

  if (targetId === g.ctx.session.uid && bodyRoleId !== undefined) {
    return NextResponse.json(
      { error: "Your own CRM permission role cannot be changed here." },
      { status: 400 },
    );
  }

  const targetSnap = await db.collection(COLLECTIONS.users).doc(targetId).get();
  if (!targetSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const targetData = targetSnap.data()!;
  if (targetData.organizationId !== orgId) {
    return NextResponse.json({ error: "User is not in this organization" }, { status: 403 });
  }

  const rosterSnap = await db
    .collection(COLLECTIONS.users)
    .where("organizationId", "==", orgId)
    .get();
  const orgUsers = rosterSnap.docs.map((d) => asUserFromAdmin(d.id, d.data()));

  const targetUser = asUserFromAdmin(targetId, targetData);
  let nextManager = targetUser.managerId;
  if (bodyManagerId !== undefined) {
    nextManager = bodyManagerId === null ? undefined : bodyManagerId;
  }
  let nextDept = targetUser.departmentId;
  if (bodyDeptId !== undefined) {
    nextDept = bodyDeptId === null ? undefined : bodyDeptId;
  }
  let nextRole = targetUser.roleId;
  if (bodyRoleId !== undefined) {
    const resolvedId = bodyRoleId === "data_scraper" ? "prospecting" : bodyRoleId;
    await resolveRoleForUser({
      organizationId: orgId,
      roleId: resolvedId,
      actorUid: g.ctx.session.uid,
    });
    const roleDoc = await getOrgRole(orgId, resolvedId);
    if (!roleDoc || !roleDoc.isActive) {
      return NextResponse.json(
        { error: "Unknown or inactive CRM permission role. Create or activate it under Configuration → CRM permissions." },
        { status: 400 },
      );
    }
    nextRole = roleDoc.id;
  }

  const orgIds = new Set(orgUsers.map((u) => u.id));
  if (nextManager && !orgIds.has(nextManager)) {
    return NextResponse.json({ error: "Manager must be a user in this organization" }, { status: 400 });
  }

  const nextUsers = orgUsers.map((u) =>
    u.id === targetId
      ? { ...u, managerId: nextManager, departmentId: nextDept, roleId: nextRole }
      : u,
  );
  if (managerAssignmentCreatesCycle(nextUsers, targetId, nextManager)) {
    return NextResponse.json(
      { error: "That manager assignment would create a reporting loop" },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (bodyManagerId !== undefined) {
    if (bodyManagerId === null) payload.managerId = FieldValue.delete();
    else payload.managerId = bodyManagerId;
  }
  if (bodyDeptId !== undefined) {
    if (bodyDeptId === null) payload.departmentId = FieldValue.delete();
    else payload.departmentId = bodyDeptId;
  }
  if (bodyRoleId !== undefined) {
    payload.roleId = nextRole;
  }
  if (bodyStatus !== undefined) {
    payload.status = bodyStatus;
  }
  if (bodyDisplayName !== undefined) {
    payload.displayName = bodyDisplayName;
  }
  if (bodyEmail !== undefined) {
    payload.email = bodyEmail.toLowerCase();
  }
  if (bodyTitle !== undefined) {
    if (bodyTitle === null || bodyTitle === "") {
      payload.title = FieldValue.delete();
    } else {
      payload.title = bodyTitle;
    }
  }
  if (bodyFeatureGrants !== undefined) {
    const normalized = normalizeFeatureGrants(bodyFeatureGrants) ?? [];
    if (normalized.length === 0) {
      payload.featureGrants = FieldValue.delete();
    } else {
      payload.featureGrants = normalized;
    }
  }

  await db.collection(COLLECTIONS.users).doc(targetId).update(payload);

  if (bodyRoleId !== undefined) {
    try {
      const roleDoc = await resolveRoleForUser({
        organizationId: orgId,
        roleId: nextRole,
        actorUid: g.ctx.session.uid,
      });
      await writeComputedPermissions({
        uid: targetId,
        organizationId: orgId,
        role: roleDoc,
      });
    } catch (e) {
      console.error("[workspace-users] computedPermissions", e);
    }
  }

  if (bodyManagerId !== undefined) {
    const nextUsers = orgUsers.map((u) =>
      u.id === targetId
        ? {
            ...u,
            managerId: bodyManagerId === null ? undefined : bodyManagerId,
          }
        : u,
    );
    const ancestorMap = buildOrgManagerAncestorIdsMap(nextUsers);
    const batch = db.batch();
    for (const u of nextUsers) {
      const ancestors = ancestorMap.get(u.id) ?? [];
      batch.update(db.collection(COLLECTIONS.users).doc(u.id), {
        managerAncestorIds: ancestors,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    try {
      const { restampOwnerManagerIdsForOrgUsers } = await import(
        "@/lib/firestore/restamp-owner-manager-ids-server"
      );
      await restampOwnerManagerIdsForOrgUsers({
        db,
        organizationId: orgId,
        users: nextUsers.map((u) => ({
          id: u.id,
          managerId: u.id === targetId
            ? bodyManagerId === null
              ? undefined
              : (bodyManagerId ?? undefined)
            : u.managerId,
          managerAncestorIds: ancestorMap.get(u.id) ?? [],
        })),
      });
    } catch (e) {
      console.error("[workspace-users] restamp ownerManagerIds", e);
    }
  }

  const profileOnly =
    bodyStatus !== undefined ||
    bodyDisplayName !== undefined ||
    bodyEmail !== undefined ||
    bodyTitle !== undefined;
  const hierarchyTouched =
    bodyManagerId !== undefined ||
    bodyDeptId !== undefined ||
    bodyRoleId !== undefined;
  const auditEvent =
    bodyFeatureGrants !== undefined && !hierarchyTouched && !profileOnly
      ? "user.feature_grants_updated"
      : profileOnly && !hierarchyTouched && bodyFeatureGrants === undefined
        ? "user.profile_updated"
        : "user.hierarchy_updated";

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: auditEvent,
    meta: {
      targetUid: targetId,
      managerId: bodyManagerId === undefined ? undefined : bodyManagerId,
      departmentId: bodyDeptId === undefined ? undefined : bodyDeptId,
      roleId: bodyRoleId,
      status: bodyStatus,
      displayName: bodyDisplayName,
      email: bodyEmail,
      title: bodyTitle === undefined ? undefined : bodyTitle,
      featureGrants: bodyFeatureGrants,
    },
  });

  return NextResponse.json({ ok: true });
}
