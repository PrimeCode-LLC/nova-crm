import {
  FieldValue,
  type DocumentData,
  type Timestamp,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  ISODate,
  Organization,
  OrganizationSettings,
  OrganizationStatus,
  SaaSPlanId,
} from "@/lib/types";
import { slugifyOrganizationName } from "@/lib/platform/slug";

/** Firestore rejects `undefined`; omit empty optional strings. */
function settingsForFirestore(s: OrganizationSettings): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.billingEmail?.trim()) out.billingEmail = s.billingEmail.trim();
  if (s.operatorNotes?.trim()) out.operatorNotes = s.operatorNotes.trim();
  return out;
}

function tsToIso(t: Timestamp | undefined): ISODate {
  if (!t?.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function docToOrg(id: string, data: DocumentData): Organization {
  const settings = (data.settings ?? {}) as OrganizationSettings;
  return {
    id,
    name: String(data.name ?? ""),
    slug: String(data.slug ?? id),
    status: (data.status as OrganizationStatus) ?? "trial",
    planId: (data.planId as SaaSPlanId) ?? "free",
    maxUsers: typeof data.maxUsers === "number" ? data.maxUsers : undefined,
    settings,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export async function listOrganizationsServer(): Promise<Organization[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => docToOrg(d.id, d.data()));
}

export async function getOrganizationServer(
  orgId: string,
): Promise<Organization | null> {
  const db = getAdminDb();
  if (!db) return null;
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const d = await ref.get();
  if (!d.exists) return null;
  return docToOrg(d.id, d.data()!);
}

export async function createOrganizationServer(input: {
  name: string;
  slug?: string;
  status?: OrganizationStatus;
  planId?: SaaSPlanId;
  maxUsers?: number;
  settings?: OrganizationSettings;
}): Promise<{ id: string } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  let slug = (input.slug ?? slugifyOrganizationName(name)).toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || "org";

  const dup = await db
    .collection(COLLECTIONS.organizations)
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (!dup.empty) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const ref = db.collection(COLLECTIONS.organizations).doc();
  const settings = settingsForFirestore(input.settings ?? {});
  const payload = {
    name,
    slug,
    status: input.status ?? "trial",
    planId: input.planId ?? "free",
    maxUsers: input.maxUsers ?? null,
    settings,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(payload);
  return { id: ref.id };
}

export async function updateOrganizationServer(
  orgId: string,
  patch: {
    name?: string;
    slug?: string;
    status?: OrganizationStatus;
    planId?: SaaSPlanId;
    maxUsers?: number | null;
    settings?: OrganizationSettings;
  },
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.slug !== undefined) {
    const s = patch.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!s) return { error: "Invalid slug" };
    const dup = await db
      .collection(COLLECTIONS.organizations)
      .where("slug", "==", s)
      .limit(2)
      .get();
    const clash = dup.docs.some((d) => d.id !== orgId);
    if (clash) return { error: "Slug already in use" };
    updates.slug = s;
  }
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.planId !== undefined) updates.planId = patch.planId;
  if (patch.maxUsers !== undefined) {
    updates.maxUsers = patch.maxUsers === null ? null : patch.maxUsers;
  }
  if (patch.settings !== undefined) {
    updates.settings = settingsForFirestore(patch.settings);
  }

  await ref.update(updates);
  return { ok: true };
}
