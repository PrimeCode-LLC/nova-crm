import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getMemberServer } from "@/lib/platform/members-server";
import type { MailboxDelegatePermission, MailboxDelegation } from "@/lib/types";

const PERMS: MailboxDelegatePermission[] = ["view", "send"];

function tsToIso(t: Timestamp | undefined | null): string {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function docToDelegation(id: string, data: DocumentData): MailboxDelegation {
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    hostId: String(data.hostId ?? ""),
    granteeUserIds: Array.isArray(data.granteeUserIds)
      ? data.granteeUserIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [],
    permissions: Array.isArray(data.permissions)
      ? data.permissions.filter((p: unknown): p is MailboxDelegatePermission =>
          PERMS.includes(p as MailboxDelegatePermission),
        )
      : ["view", "send"],
    createdBy: String(data.createdBy ?? ""),
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

function delegationDocId(organizationId: string, hostId: string): string {
  return `${organizationId}_${hostId}`;
}

export async function getDelegationForHostServer(input: {
  organizationId: string;
  hostId: string;
}): Promise<MailboxDelegation | null> {
  const db = getAdminDb();
  if (!db) return null;
  const ref = db
    .collection(COLLECTIONS.mailboxDelegations)
    .doc(delegationDocId(input.organizationId, input.hostId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (String(data.organizationId) !== input.organizationId || String(data.hostId) !== input.hostId) {
    return null;
  }
  return docToDelegation(snap.id, data);
}

async function validateGranteeUserIds(input: {
  organizationId: string;
  hostId: string;
  granteeUserIds: string[];
}): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const unique = [...new Set(input.granteeUserIds.map((id) => id.trim()).filter(Boolean))].filter(
    (id) => id !== input.hostId,
  );
  for (const uid of unique) {
    const member = await getMemberServer(input.organizationId, uid);
    if (!member || member.status !== "active") {
      return { ok: false, error: "One or more selected members are not active in this workspace." };
    }
  }
  return { ok: true, ids: unique };
}

export async function upsertDelegationForHostServer(input: {
  organizationId: string;
  hostId: string;
  granteeUserIds: string[];
  createdBy: string;
}): Promise<{ delegation: MailboxDelegation } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const validated = await validateGranteeUserIds({
    organizationId: input.organizationId,
    hostId: input.hostId,
    granteeUserIds: input.granteeUserIds,
  });
  if (!validated.ok) return { error: validated.error };

  const ref = db
    .collection(COLLECTIONS.mailboxDelegations)
    .doc(delegationDocId(input.organizationId, input.hostId));
  const existing = await ref.get();
  const permissions: MailboxDelegatePermission[] = ["view", "send"];

  if (!existing.exists) {
    if (validated.ids.length === 0) {
      return {
        delegation: {
          id: ref.id,
          organizationId: input.organizationId,
          hostId: input.hostId,
          granteeUserIds: [],
          permissions,
          createdBy: input.createdBy,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }
    await ref.set({
      organizationId: input.organizationId,
      hostId: input.hostId,
      granteeUserIds: validated.ids,
      permissions,
      createdBy: input.createdBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    if (validated.ids.length === 0) {
      await ref.delete();
      return {
        delegation: {
          id: ref.id,
          organizationId: input.organizationId,
          hostId: input.hostId,
          granteeUserIds: [],
          permissions,
          createdBy: String(existing.data()?.createdBy ?? input.createdBy),
          createdAt: tsToIso(existing.data()?.createdAt as Timestamp | undefined),
          updatedAt: new Date().toISOString(),
        },
      };
    }
    await ref.update({
      granteeUserIds: validated.ids,
      permissions,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const fresh = await ref.get();
  if (!fresh.exists) {
    return {
      delegation: {
        id: ref.id,
        organizationId: input.organizationId,
        hostId: input.hostId,
        granteeUserIds: [],
        permissions,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return { delegation: docToDelegation(ref.id, fresh.data()!) };
}

export async function removeGranteeFromHostServer(input: {
  organizationId: string;
  hostId: string;
  granteeUid: string;
}): Promise<{ ok: true } | { error: string }> {
  const delegation = await getDelegationForHostServer({
    organizationId: input.organizationId,
    hostId: input.hostId,
  });
  if (!delegation) return { error: "No delegation found" };
  const next = delegation.granteeUserIds.filter((id) => id !== input.granteeUid);
  const r = await upsertDelegationForHostServer({
    organizationId: input.organizationId,
    hostId: input.hostId,
    granteeUserIds: next,
    createdBy: delegation.createdBy,
  });
  if ("error" in r) return { error: r.error };
  return { ok: true };
}

export async function viewerHasMailboxDelegationServer(input: {
  organizationId: string;
  hostId: string;
  viewerUid: string;
  permission: MailboxDelegatePermission;
}): Promise<boolean> {
  if (input.viewerUid === input.hostId) return true;
  const delegation = await getDelegationForHostServer({
    organizationId: input.organizationId,
    hostId: input.hostId,
  });
  if (!delegation) return false;
  if (!delegation.permissions.includes(input.permission)) return false;
  return delegation.granteeUserIds.includes(input.viewerUid);
}

export async function listAccessibleHostsForGranteeServer(input: {
  organizationId: string;
  granteeUid: string;
}): Promise<string[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.mailboxDelegations)
    .where("organizationId", "==", input.organizationId)
    .get();
  const hostIds: string[] = [];
  for (const doc of snap.docs) {
    const delegation = docToDelegation(doc.id, doc.data());
    if (delegation.hostId === input.granteeUid) continue;
    if (!delegation.granteeUserIds.includes(input.granteeUid)) continue;
    if (!delegation.permissions.includes("view")) continue;
    hostIds.push(delegation.hostId);
  }
  return hostIds.sort();
}
