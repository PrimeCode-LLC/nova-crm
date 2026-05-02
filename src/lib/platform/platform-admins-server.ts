import { FieldValue } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ISODate, PlatformAdminRecord, PlatformAdminRole } from "@/lib/types";

function tsToIso(v: { toDate?: () => Date } | undefined): ISODate {
  if (!v?.toDate) return new Date().toISOString();
  return v.toDate().toISOString();
}

export async function listPlatformAdminsServer(): Promise<PlatformAdminRecord[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTIONS.platformAdmins).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id,
      email: String(x.email ?? ""),
      role: (x.role as PlatformAdminRole) ?? "admin",
      active: x.active !== false,
      createdByUid: x.createdByUid as string | undefined,
      createdAt: tsToIso(x.createdAt),
    };
  });
}

export async function grantPlatformAdminServer(
  adminAuth: Auth,
  emailRaw: string,
  role: PlatformAdminRole,
  createdByUid: string,
): Promise<{ ok: true } | { error: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { error: "Email is required" };

  let uid: string;
  try {
    const u = await adminAuth.getUserByEmail(email);
    uid = u.uid;
  } catch {
    return {
      error:
        "No Firebase user with that email. They must sign up once before you can grant platform access.",
    };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.platformAdmins).doc(uid);
  const existing = await ref.get();
  const base = {
    email,
    role,
    active: true,
    createdByUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing.exists) {
    await ref.set({ ...base, createdAt: FieldValue.serverTimestamp() });
  } else {
    await ref.set(base, { merge: true });
  }

  return { ok: true };
}

export async function revokePlatformAdminServer(
  actorUid: string,
  targetUid: string,
): Promise<{ ok: true } | { error: string }> {
  if (actorUid === targetUid) {
    return { error: "You cannot revoke your own platform access." };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const admins = await listPlatformAdminsServer();
  const target = admins.find((a) => a.uid === targetUid);
  const activeOwners = admins.filter((a) => a.active && a.role === "owner");
  if (
    target?.active &&
    target.role === "owner" &&
    activeOwners.length <= 1
  ) {
    return { error: "Cannot remove the last active owner." };
  }

  await db.collection(COLLECTIONS.platformAdmins).doc(targetUid).delete();
  return { ok: true };
}
