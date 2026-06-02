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
import type { Role, User } from "@/lib/types";

const ROLE_IDS = [
  "director",
  "manager",
  "team_lead",
  "salesperson",
  "data_scraper",
  "prospecting",
] as const;

const patchSchema = z
  .object({
    userId: z.string().min(1),
    managerId: z.union([z.string().min(1), z.null()]).optional(),
    departmentId: z.union([z.string().min(1), z.null()]).optional(),
    roleId: z.enum(ROLE_IDS).optional(),
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
    featureGrants: bodyFeatureGrants,
  } = parsed.data;

  if (targetId === g.ctx.session.uid && bodyRoleId !== undefined) {
    return NextResponse.json(
      { error: "CRM role for your own account is managed via signup and org membership." },
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
    nextRole = bodyRoleId;
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
    payload.roleId = bodyRoleId;
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
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: bodyFeatureGrants !== undefined ? "user.feature_grants_updated" : "user.hierarchy_updated",
    meta: {
      targetUid: targetId,
      managerId: bodyManagerId === undefined ? undefined : bodyManagerId,
      departmentId: bodyDeptId === undefined ? undefined : bodyDeptId,
      roleId: bodyRoleId,
      featureGrants: bodyFeatureGrants,
    },
  });

  return NextResponse.json({ ok: true });
}
