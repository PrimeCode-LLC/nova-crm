import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import {
  resolveNovaUidByEmailServer,
  syncClerkNovaClaims,
} from "@/lib/auth/clerk-identity";
import { parseBootstrapPlatformAdminEmails } from "@/lib/platform/check-platform-admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { ISODate, PlatformAdminRecord, PlatformAdminRole } from "@/lib/types";

function tsToIso(v: { toDate?: () => Date } | undefined): ISODate {
  if (!v?.toDate) return new Date().toISOString();
  return v.toDate().toISOString();
}

export async function listPlatformAdminsServer(): Promise<PlatformAdminRecord[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTIONS.platformAdmins).get();
  const stored = snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id,
      email: String(x.email ?? ""),
      role: (x.role as PlatformAdminRole) ?? "admin",
      active: x.active !== false,
      createdByUid: x.createdByUid as string | undefined,
      createdAt: tsToIso(x.createdAt),
      bootstrap: false,
    };
  });

  const bootstrapEmails = parseBootstrapPlatformAdminEmails();
  const storedEmails = new Set(stored.map((a) => a.email.toLowerCase()));
  const bootstrapRecords: PlatformAdminRecord[] = [...bootstrapEmails]
    .filter((email) => !storedEmails.has(email))
    .map((email) => ({
      uid: `bootstrap:${email}`,
      email,
      role: "owner" as PlatformAdminRole,
      active: true,
      createdAt: new Date(0).toISOString(),
      bootstrap: true,
    }));

  return [...stored, ...bootstrapRecords].sort((a, b) =>
    a.email.localeCompare(b.email),
  );
}

export async function updatePlatformAdminRoleServer(
  targetUid: string,
  role: PlatformAdminRole,
  actorUid: string,
): Promise<{ ok: true } | { error: string }> {
  if (targetUid.startsWith("bootstrap:")) {
    return { error: "Bootstrap admins are managed via PLATFORM_ADMIN_EMAILS env." };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.platformAdmins).doc(targetUid);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Platform admin not found" };

  const admins = await listPlatformAdminsServer();
  const target = admins.find((a) => a.uid === targetUid && !a.bootstrap);
  const activeOwners = admins.filter(
    (a) => a.active && a.role === "owner" && !a.bootstrap,
  );
  if (
    target?.active &&
    target.role === "owner" &&
    role !== "owner" &&
    activeOwners.length <= 1
  ) {
    return { error: "Cannot demote the last active owner." };
  }

  await ref.set(
    {
      role,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    },
    { merge: true },
  );
  return { ok: true };
}

export async function grantPlatformAdminServer(
  emailRaw: string,
  role: PlatformAdminRole,
  createdByUid: string,
): Promise<{ ok: true } | { error: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { error: "Email is required" };

  const resolved = await resolveNovaUidByEmailServer(email);
  if (!resolved) {
    return {
      error:
        "No Clerk account with that email. They must sign up once before you can grant platform access.",
    };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const { uid, clerkUserId } = resolved;
  const ref = db.collection(COLLECTIONS.platformAdmins).doc(uid);
  const existing = await ref.get();
  const base = {
    email: resolved.email,
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

  await syncClerkNovaClaims(clerkUserId, {
    novaUid: uid,
    platformAdmin: true,
  });

  return { ok: true };
}

export async function revokePlatformAdminServer(
  actorUid: string,
  targetUid: string,
): Promise<{ ok: true } | { error: string }> {
  if (targetUid.startsWith("bootstrap:")) {
    return { error: "Bootstrap admins are managed via PLATFORM_ADMIN_EMAILS env." };
  }
  if (actorUid === targetUid) {
    return { error: "You cannot revoke your own platform access." };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const admins = await listPlatformAdminsServer();
  const target = admins.find((a) => a.uid === targetUid && !a.bootstrap);
  const activeOwners = admins.filter(
    (a) => a.active && a.role === "owner" && !a.bootstrap,
  );
  if (
    target?.active &&
    target.role === "owner" &&
    activeOwners.length <= 1
  ) {
    return { error: "Cannot remove the last active owner." };
  }

  await db.collection(COLLECTIONS.platformAdmins).doc(targetUid).delete();

  const resolved = await resolveNovaUidByEmailServer(target?.email ?? "");
  if (resolved) {
    await syncClerkNovaClaims(resolved.clerkUserId, {
      novaUid: resolved.uid,
      platformAdmin: false,
    });
  }

  return { ok: true };
}
