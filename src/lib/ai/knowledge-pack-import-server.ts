import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import { mergeFitCheckKnowledgeConfig } from "@/lib/ai/fit-check-knowledge-types";
import {
  getOrganizationAiSettingsServer,
  updateOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import {
  parseKnowledgePack,
  parsePromptsPack,
  type KnowledgePack,
  type PromptsPack,
} from "@/lib/ai/knowledge-pack-schema";
import {
  previewKnowledgePack,
  previewPromptsPack,
  type KnowledgePackPreview,
  type PromptsPackPreview,
} from "@/lib/ai/knowledge-pack-preview";
import { REQUIRED_PROMPT_VARS } from "@/lib/ai/prompt-defaults";
import { stripUndefined } from "@/lib/documents/strip-undefined";

export type { KnowledgePackPreview, PromptsPackPreview };
export { previewKnowledgePack, previewPromptsPack };

function requireDb() {
  const db = getAdminDb();
  if (!db) {
    throw new Error("Database is not configured. Set DATABASE_URL.");
  }
  return db;
}

export async function previewKnowledgePackWithExisting(input: {
  pack: unknown;
  targetOrganizationId: string;
}): Promise<KnowledgePackPreview | { ok: false; error: string }> {
  const base = previewKnowledgePack(input);
  if (!base.ok) return base;
  const db = requireDb();
  const orgId = input.targetOrganizationId;
  const orgRef = db.collection(COLLECTIONS.organizations).doc(orgId);
  const [libSnap, docSnap, brandSnap] = await Promise.all([
    orgRef.collection(ORG_SUBCOLLECTIONS.aiLibraries).get(),
    orgRef.collection(ORG_SUBCOLLECTIONS.aiDocuments).get(),
    db.collection(COLLECTIONS.contentBrands).where("organizationId", "==", orgId).get(),
  ]);
  return {
    ...base,
    existing: {
      libraries: libSnap.size,
      documents: docSnap.size,
      brands: brandSnap.size,
    },
  };
}

export async function importKnowledgePackServer(input: {
  pack: unknown;
  targetOrganizationId: string;
  userId: string;
  indexDocuments?: boolean;
}): Promise<
  | {
      ok: true;
      imported: {
        libraries: number;
        documents: number;
        brands: number;
        profilesUpdated: number;
      };
      indexed: { ok: number; failed: number; errors: string[] };
    }
  | { ok: false; error: string }
> {
  let pack: KnowledgePack;
  try {
    pack = parseKnowledgePack(input.pack);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid knowledge pack" };
  }

  const db = requireDb();
  const orgId = input.targetOrganizationId.trim();
  if (!orgId) return { ok: false, error: "targetOrganizationId is required" };

  const now = new Date().toISOString();
  const orgRef = db.collection(COLLECTIONS.organizations).doc(orgId);

  for (const lib of pack.libraries) {
    const { id, ...rest } = lib;
    await orgRef
      .collection(ORG_SUBCOLLECTIONS.aiLibraries)
      .doc(id)
      .set(
        stripUndefined({
          ...rest,
          organizationId: orgId,
          documentCount: rest.documentCount ?? 0,
          chunkCount: 0,
          updatedAt: now,
          createdAt: rest.createdAt ?? now,
        }) as Record<string, unknown>,
        { merge: true },
      );
  }

  for (const doc of pack.documents) {
    const { id, ...rest } = doc;
    await orgRef
      .collection(ORG_SUBCOLLECTIONS.aiDocuments)
      .doc(id)
      .set(
        stripUndefined({
          ...rest,
          organizationId: orgId,
          chunkCount: 0,
          updatedAt: now,
          createdAt: rest.createdAt ?? now,
        }) as Record<string, unknown>,
        { merge: true },
      );
  }

  for (const brand of pack.brands) {
    const { id, ...rest } = brand;
    await db
      .collection(COLLECTIONS.contentBrands)
      .doc(id)
      .set(
        stripUndefined({
          ...rest,
          id,
          organizationId: orgId,
          updatedAt: now,
          createdAt: (rest as { createdAt?: string }).createdAt ?? now,
        }) as Record<string, unknown>,
        { merge: true },
      );
  }

  let profilesUpdated = 0;
  for (const [profileId, libraryIds] of Object.entries(pack.links.profileKnowledgeLibraryIds)) {
    const ref = db.collection(COLLECTIONS.profiles).doc(profileId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() as Record<string, unknown>;
    if (data.organizationId && data.organizationId !== orgId) continue;
    await ref.set(
      {
        knowledgeLibraryIds: libraryIds,
        updatedAt: now,
      },
      { merge: true },
    );
    profilesUpdated += 1;
  }

  if (pack.fitCheckKnowledge || pack.embedding) {
    const current = await getOrganizationAiSettingsServer(orgId);
    const patch: Parameters<typeof updateOrganizationAiSettingsServer>[1] = {};
    if (pack.fitCheckKnowledge) {
      patch.fitCheckKnowledge = mergeFitCheckKnowledgeConfig(pack.fitCheckKnowledge);
    }
    if (pack.embedding?.model) patch.embeddingModel = pack.embedding.model;
    if (pack.embedding?.provider === "openai" || pack.embedding?.provider === "anthropic" || pack.embedding?.provider === "google") {
      patch.embeddingProvider = pack.embedding.provider;
    }
    // Keep AI usable after import when org had never enabled the flag.
    if (!current.enabled) patch.enabled = true;
    await updateOrganizationAiSettingsServer(orgId, patch);
  }

  // Recompute library document counts from imported docs.
  const docsByLibrary = new Map<string, number>();
  for (const d of pack.documents) {
    docsByLibrary.set(d.libraryId, (docsByLibrary.get(d.libraryId) ?? 0) + 1);
  }
  for (const [libraryId, count] of docsByLibrary) {
    await orgRef.collection(ORG_SUBCOLLECTIONS.aiLibraries).doc(libraryId).set(
      {
        documentCount: count,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  const indexed = { ok: 0, failed: 0, errors: [] as string[] };
  if (input.indexDocuments !== false) {
    for (const doc of pack.documents) {
      const result = await indexAiDocumentServer({
        organizationId: orgId,
        documentId: doc.id,
        userId: input.userId,
      });
      if ("error" in result) {
        indexed.failed += 1;
        indexed.errors.push(`${doc.id}: ${result.error}`);
      } else {
        indexed.ok += 1;
      }
    }
  }

  return {
    ok: true,
    imported: {
      libraries: pack.libraries.length,
      documents: pack.documents.length,
      brands: pack.brands.length,
      profilesUpdated,
    },
    indexed,
  };
}

export async function importPromptsPackServer(input: {
  pack: unknown;
}): Promise<
  | { ok: true; written: number; skippedStale: number; featureKeys: string[] }
  | { ok: false; error: string }
> {
  let pack: PromptsPack;
  try {
    pack = parsePromptsPack(input.pack);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid prompts pack" };
  }

  const db = requireDb();
  const now = new Date().toISOString();
  let written = 0;
  let skippedStale = 0;
  const featureKeys: string[] = [];

  for (const entry of pack.prompts) {
    const required = REQUIRED_PROMPT_VARS[entry.featureKey] ?? [];
    const stale = required.some((name) => !entry.userPromptTemplate.includes(`{{${name}}}`));
    if (stale) {
      skippedStale += 1;
      continue;
    }
    await db
      .collection(COLLECTIONS.platformAiPrompts)
      .doc(entry.featureKey)
      .set({
        featureKey: entry.featureKey,
        systemPrompt: entry.systemPrompt,
        userPromptTemplate: entry.userPromptTemplate,
        version: entry.version ?? 1,
        updatedAt: now,
        importedAt: now,
        importSource: entry.source,
      });
    written += 1;
    featureKeys.push(entry.featureKey);
  }

  return { ok: true, written, skippedStale, featureKeys };
}
