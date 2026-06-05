import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import type {
  CalendarDelegatePermission,
  CalendarDelegation,
  CalendarGranteeType,
  User,
} from "@/lib/types";

function tsToIso(t: Timestamp | undefined | null): string {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

const PERMS: CalendarDelegatePermission[] = [
  "view_availability",
  "book",
  "manage_links",
  "cancel",
];

const GRANTEE_TYPES: CalendarGranteeType[] = [
  "user",
  "role",
  "department",
  "org",
  "reports",
];

function docToDelegation(id: string, data: DocumentData): CalendarDelegation {
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    hostId: String(data.hostId ?? ""),
    hostName: typeof data.hostName === "string" ? data.hostName : undefined,
    granteeType: GRANTEE_TYPES.includes(data.granteeType as CalendarGranteeType)
      ? (data.granteeType as CalendarGranteeType)
      : "user",
    granteeIds: Array.isArray(data.granteeIds)
      ? data.granteeIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [],
    permissions: Array.isArray(data.permissions)
      ? data.permissions.filter((p: unknown): p is CalendarDelegatePermission =>
          PERMS.includes(p as CalendarDelegatePermission),
        )
      : ["view_availability", "book"],
    schedulingLinkIds: Array.isArray(data.schedulingLinkIds)
      ? data.schedulingLinkIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined,
    createdBy: String(data.createdBy ?? ""),
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

function viewerMatchesGrantee(
  viewer: User,
  delegation: CalendarDelegation,
  orgUserIds: Set<string>,
): boolean {
  switch (delegation.granteeType) {
    case "user":
      return delegation.granteeIds.includes(viewer.id);
    case "role":
      return delegation.granteeIds.includes(viewer.roleId);
    case "department":
      return Boolean(
        viewer.departmentId && delegation.granteeIds.includes(viewer.departmentId),
      );
    case "org":
      return orgUserIds.has(viewer.id);
    case "reports":
      return viewer.managerId === delegation.hostId;
    default:
      return false;
  }
}

export async function listDelegationsForHostServer(input: {
  organizationId: string;
  hostId: string;
}): Promise<CalendarDelegation[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.calendarDelegations)
    .where("organizationId", "==", input.organizationId)
    .where("hostId", "==", input.hostId)
    .get();
  return snap.docs.map((d) => docToDelegation(d.id, d.data()));
}

export async function listDelegationsForOrgServer(
  organizationId: string,
): Promise<CalendarDelegation[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.calendarDelegations)
    .where("organizationId", "==", organizationId)
    .get();
  return snap.docs.map((d) => docToDelegation(d.id, d.data()));
}

export async function createDelegationServer(input: {
  organizationId: string;
  hostId: string;
  hostName?: string;
  granteeType: CalendarGranteeType;
  granteeIds: string[];
  permissions: CalendarDelegatePermission[];
  schedulingLinkIds?: string[];
  createdBy: string;
}): Promise<{ delegation: CalendarDelegation } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  if (!input.granteeIds.length && input.granteeType !== "org") {
    return { error: "Select at least one grantee." };
  }
  const payload = {
    organizationId: input.organizationId,
    hostId: input.hostId,
    hostName: input.hostName ?? "",
    granteeType: input.granteeType,
    granteeIds: input.granteeType === "org" ? [] : input.granteeIds,
    permissions: input.permissions.length ? input.permissions : ["view_availability", "book"],
    schedulingLinkIds: input.schedulingLinkIds ?? [],
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTIONS.calendarDelegations).add(payload);
  const fresh = await ref.get();
  return { delegation: docToDelegation(ref.id, fresh.data()!) };
}

export async function deleteDelegationServer(input: {
  organizationId: string;
  id: string;
  hostId: string;
}): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.calendarDelegations).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Delegation not found" };
  const data = snap.data()!;
  if (
    String(data.organizationId) !== input.organizationId ||
    String(data.hostId) !== input.hostId
  ) {
    return { error: "Delegation not found" };
  }
  await ref.delete();
  return { ok: true };
}

export async function resolveCalendarHostAccessServer(input: {
  organizationId: string;
  viewerUid: string;
  hostId: string;
  action: CalendarDelegatePermission;
  schedulingLinkId?: string;
}): Promise<{ allowed: boolean; isHost: boolean }> {
  if (input.viewerUid === input.hostId) {
    return { allowed: true, isHost: true };
  }

  const db = getAdminDb();
  if (!db) return { allowed: false, isHost: false };

  const orgUsers = await listOrgUsersServer(input.organizationId);
  const viewer = orgUsers.find((u) => u.id === input.viewerUid);
  if (!viewer) return { allowed: false, isHost: false };

  const orgUserIds = new Set(orgUsers.map((u) => u.id));
  const snap = await db
    .collection(COLLECTIONS.calendarDelegations)
    .where("organizationId", "==", input.organizationId)
    .where("hostId", "==", input.hostId)
    .get();

  for (const doc of snap.docs) {
    const delegation = docToDelegation(doc.id, doc.data());
    if (!delegation.permissions.includes(input.action)) continue;
    if (
      input.schedulingLinkId &&
      delegation.schedulingLinkIds?.length &&
      !delegation.schedulingLinkIds.includes(input.schedulingLinkId)
    ) {
      continue;
    }
    if (viewerMatchesGrantee(viewer, delegation, orgUserIds)) {
      return { allowed: true, isHost: false };
    }
  }

  return { allowed: false, isHost: false };
}

export async function listDelegatedHostsForViewerServer(input: {
  organizationId: string;
  viewerUid: string;
  action?: CalendarDelegatePermission;
}): Promise<{ hostId: string; hostName: string; permissions: CalendarDelegatePermission[] }[]> {
  const action = input.action ?? "book";
  const db = getAdminDb();
  if (!db) return [];

  const orgUsers = await listOrgUsersServer(input.organizationId);
  const viewer = orgUsers.find((u) => u.id === input.viewerUid);
  if (!viewer) return [];

  const orgUserIds = new Set(orgUsers.map((u) => u.id));
  const snap = await db
    .collection(COLLECTIONS.calendarDelegations)
    .where("organizationId", "==", input.organizationId)
    .get();

  const byHost = new Map<
    string,
    { hostId: string; hostName: string; permissions: Set<CalendarDelegatePermission> }
  >();

  for (const doc of snap.docs) {
    const delegation = docToDelegation(doc.id, doc.data());
    if (delegation.hostId === input.viewerUid) continue;
    if (!delegation.permissions.includes(action)) continue;
    if (!viewerMatchesGrantee(viewer, delegation, orgUserIds)) continue;

    const host = orgUsers.find((u) => u.id === delegation.hostId);
    const hostName =
      delegation.hostName?.trim() ||
      host?.displayName?.trim() ||
      host?.email?.split("@")[0] ||
      delegation.hostId;

    const existing = byHost.get(delegation.hostId);
    if (existing) {
      for (const p of delegation.permissions) existing.permissions.add(p);
    } else {
      byHost.set(delegation.hostId, {
        hostId: delegation.hostId,
        hostName,
        permissions: new Set(delegation.permissions),
      });
    }
  }

  return [...byHost.values()]
    .map((h) => ({
      hostId: h.hostId,
      hostName: h.hostName,
      permissions: [...h.permissions],
    }))
    .sort((a, b) => a.hostName.localeCompare(b.hostName));
}
