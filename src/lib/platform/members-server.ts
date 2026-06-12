import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { isFirestoreFailedPrecondition } from "@/lib/firestore/errors";
import type {
  ISODate,
  OrganizationMember,
  OrgMemberRole,
  OrgMemberStatus,
} from "@/lib/types";
import {
  bumpOrganizationSeatsServer,
  getOrganizationServer,
} from "@/lib/platform/organizations-server";

function tsToIso(t: Timestamp | undefined | null): ISODate {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function maybeTsToIso(t: Timestamp | undefined | null): ISODate | undefined {
  if (!t || !t.toDate) return undefined;
  return t.toDate().toISOString();
}

function docToMember(
  organizationId: string,
  uid: string,
  data: DocumentData,
): OrganizationMember {
  return {
    uid,
    organizationId,
    email: String(data.email ?? "").toLowerCase(),
    displayName: String(data.displayName ?? ""),
    role: (data.role as OrgMemberRole) ?? "member",
    status: (data.status as OrgMemberStatus) ?? "active",
    invitedByUid: String(data.invitedByUid ?? ""),
    joinedAt: tsToIso(data.joinedAt as Timestamp | undefined),
    disabledAt: maybeTsToIso(data.disabledAt as Timestamp | undefined),
  };
}

function membersCol(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members);
}

export async function listMembersServer(
  orgId: string,
): Promise<OrganizationMember[]> {
  const col = membersCol(orgId);
  if (!col) return [];
  const snap = await col.orderBy("joinedAt", "desc").get();
  return snap.docs.map((d) => docToMember(orgId, d.id, d.data()));
}

export async function getMemberServer(
  orgId: string,
  uid: string,
): Promise<OrganizationMember | null> {
  const col = membersCol(orgId);
  if (!col) return null;
  const d = await col.doc(uid).get();
  if (!d.exists) return null;
  return docToMember(orgId, d.id, d.data()!);
}

export async function findMembershipForUserServer(
  uid: string,
): Promise<OrganizationMember | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db
    .collectionGroup(ORG_SUBCOLLECTIONS.members)
    .where("uid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  const orgId = d.ref.parent.parent?.id ?? "";
  return docToMember(orgId, d.id, d.data());
}

export const OTHER_WORKSPACE_JOIN_ERROR =
  "This account already belongs to another workspace. They must leave it before joining here.";

export const OTHER_WORKSPACE_OWNER_ERROR =
  "This account already belongs to another workspace. They must leave it before becoming owner here.";

/**
 * Resolves which workspace a user belongs to (active or pending).
 * Falls back to `users/{uid}` when the collection-group index is unavailable.
 */
export async function resolveUserTenantIdServer(
  uid: string,
): Promise<string | null> {
  try {
    const m = await findMembershipForUserServer(uid);
    if (m) return m.organizationId;
  } catch (err: unknown) {
    if (!isFirestoreFailedPrecondition(err)) throw err;
  }

  const db = getAdminDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const active =
    typeof data.organizationId === "string" && data.organizationId.trim()
      ? data.organizationId.trim()
      : undefined;
  if (active) return active;
  const pending =
    typeof data.membershipPendingOrgId === "string" &&
    data.membershipPendingOrgId.trim()
      ? data.membershipPendingOrgId.trim()
      : undefined;
  return pending ?? null;
}

/** Blocks adding a user to `targetOrgId` when they already belong elsewhere. */
export async function assertNotMemberOfOtherOrgServer(
  uid: string,
  targetOrgId: string,
  opts?: { context?: "join" | "owner" },
): Promise<{ ok: true } | { error: string }> {
  const tenantId = await resolveUserTenantIdServer(uid);
  if (tenantId && tenantId !== targetOrgId) {
    return {
      error:
        opts?.context === "owner"
          ? OTHER_WORKSPACE_OWNER_ERROR
          : OTHER_WORKSPACE_JOIN_ERROR,
    };
  }
  return { ok: true };
}

/** Blocks linking a user as owner of a new workspace when they already have one. */
export async function assertUserHasNoWorkspaceServer(
  uid: string,
  opts?: { context?: "join" | "owner" },
): Promise<{ ok: true } | { error: string }> {
  const tenantId = await resolveUserTenantIdServer(uid);
  if (tenantId) {
    return {
      error:
        opts?.context === "owner"
          ? OTHER_WORKSPACE_OWNER_ERROR
          : OTHER_WORKSPACE_JOIN_ERROR,
    };
  }
  return { ok: true };
}

export async function upsertMemberServer(input: {
  organizationId: string;
  uid: string;
  email: string;
  displayName: string;
  role: OrgMemberRole;
  status?: OrgMemberStatus;
  invitedByUid: string;
}): Promise<{ created: boolean } | { error: string }> {
  const col = membersCol(input.organizationId);
  if (!col) return { error: "Database not configured" };

  const ref = col.doc(input.uid);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  const payload: Record<string, unknown> = {
    uid: input.uid,
    organizationId: input.organizationId,
    email: input.email.toLowerCase(),
    displayName: input.displayName,
    role: input.role,
    status: input.status ?? "active",
    invitedByUid: input.invitedByUid,
    updatedAt: now,
  };
  if (!existing.exists) payload.joinedAt = now;

  await ref.set(payload, { merge: true });

  const nextStatus = (payload.status as OrgMemberStatus) ?? "active";
  if (!existing.exists && nextStatus === "active") {
    await bumpOrganizationSeatsServer(input.organizationId, 1);
  }
  return { created: !existing.exists };
}

export async function setMemberStatusServer(
  orgId: string,
  uid: string,
  status: OrgMemberStatus,
): Promise<{ ok: true } | { error: string }> {
  const col = membersCol(orgId);
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(uid);
  const before = await ref.get();
  if (!before.exists) return { error: "Member not found" };
  const prevStatus = (before.data()?.status as OrgMemberStatus) ?? "active";

  const updates: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "disabled") {
    updates.disabledAt = FieldValue.serverTimestamp();
  } else if (prevStatus === "disabled") {
    updates.disabledAt = FieldValue.delete();
  }
  await ref.update(updates);

  if (prevStatus !== "active" && status === "active") {
    await bumpOrganizationSeatsServer(orgId, 1);
  } else if (prevStatus === "active" && status !== "active") {
    await bumpOrganizationSeatsServer(orgId, -1);
  }
  return { ok: true };
}

export async function setMemberRoleServer(
  orgId: string,
  uid: string,
  role: OrgMemberRole,
): Promise<{ ok: true } | { error: string }> {
  const col = membersCol(orgId);
  if (!col) return { error: "Database not configured" };
  const ref = col.doc(uid);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Member not found" };
  await ref.update({
    role,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

export async function deleteMemberServer(
  orgId: string,
  uid: string,
): Promise<{ ok: true } | { error: string }> {
  const col = membersCol(orgId);
  if (!col) return { error: "Database not configured" };
  const cur = await col.doc(uid).get();
  if (!cur.exists) return { error: "Member not found" };
  const prevStatus = (cur.data()?.status as OrgMemberStatus | undefined) ?? "active";
  await col.doc(uid).delete();
  if (prevStatus === "active") {
    await bumpOrganizationSeatsServer(orgId, -1);
  }
  return { ok: true };
}

/**
 * True if the org has spare seats (or no cap). Pass `excludeUid` if you're
 * re-activating a member that already counts.
 */
export async function hasSeatAvailableServer(
  orgId: string,
): Promise<{ ok: true } | { error: string }> {
  const org = await getOrganizationServer(orgId);
  if (!org) return { error: "Organization not found" };
  const cap = org.maxUsers ?? null;
  if (cap == null) return { ok: true };
  const used = org.seatsUsed ?? 0;
  if (used >= cap) {
    return { error: `Seat limit reached (${used}/${cap}). Upgrade plan or remove an inactive member.` };
  }
  return { ok: true };
}
