import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { mapContentBrand } from "@/lib/content-calendar/map-docs";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import { stripUndefined } from "@/lib/documents/strip-undefined";
import type { ContentBrand, ContentBrandKind } from "@/lib/content-calendar/types";

export async function listContentBrandsServer(
  organizationId: string,
): Promise<ContentBrand[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.contentBrands)
    .where("organizationId", "==", organizationId)
    .get();
  return snap.docs.map((d) => mapContentBrand(d.id, (d.data() ?? {}) as Record<string, unknown>));
}

export async function upsertContentBrandServer(input: {
  organizationId: string;
  userId: string;
  brandId?: string;
  name: string;
  kind: ContentBrandKind;
  voiceRules?: string;
  positioning?: string;
  knowledgeLibraryIds: string[];
}): Promise<{ ok: true; brand: ContentBrand } | { ok: false; error: string }> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const now = new Date().toISOString();
  const isNew = !input.brandId;
  const id =
    input.brandId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `cbrand-${crypto.randomUUID()}`
      : `cbrand-${Date.now()}`);

  if (isNew) {
    const defaults = buildBrandDefaultsFromPack({
      kind: input.kind,
      name: input.name.trim(),
    });
    const brand: ContentBrand = {
      ...defaults,
      id,
      organizationId: input.organizationId,
      name: input.name.trim(),
      kind: input.kind,
      voiceRules: input.voiceRules?.trim() || defaults.voiceRules,
      positioning: input.positioning?.trim() || defaults.positioning,
      knowledgeLibraryIds: input.knowledgeLibraryIds,
      proofSources: "",
      preferredCtas: "",
      ownerUserId: input.userId,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .collection(COLLECTIONS.contentBrands)
      .doc(id)
      .set(stripUndefined({ ...brand }) as Record<string, unknown>);
    return { ok: true, brand };
  }

  const ref = db.collection(COLLECTIONS.contentBrands).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Brand not found" };
  const existing = mapContentBrand(id, (snap.data() ?? {}) as Record<string, unknown>);
  if (existing.organizationId !== input.organizationId) {
    return { ok: false, error: "Brand not found" };
  }

  const patch = {
    name: input.name.trim(),
    kind: input.kind,
    voiceRules: input.voiceRules?.trim() ?? existing.voiceRules,
    positioning: input.positioning?.trim() ?? existing.positioning,
    knowledgeLibraryIds: input.knowledgeLibraryIds,
    updatedAt: now,
  };
  await ref.set(stripUndefined(patch) as Record<string, unknown>, { merge: true });
  return { ok: true, brand: { ...existing, ...patch } };
}

export async function deleteContentBrandServer(input: {
  organizationId: string;
  brandId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.contentBrands).doc(input.brandId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Brand not found" };
  const data = snap.data() as Record<string, unknown>;
  if (data.organizationId !== input.organizationId) {
    return { ok: false, error: "Brand not found" };
  }
  await ref.delete();
  return { ok: true };
}
