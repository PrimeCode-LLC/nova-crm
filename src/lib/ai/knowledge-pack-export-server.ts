import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  buildKnowledgePack,
  buildPromptsPack,
  normalizeBrandDoc,
  normalizeDocumentDoc,
  normalizeLibraryDoc,
} from "@/lib/ai/knowledge-pack-build";
import { mergeFitCheckKnowledgeConfig } from "@/lib/ai/fit-check-knowledge-types";
import { AI_FEATURE_KEYS } from "@/lib/ai/knowledge-pack-schema";
import type { KnowledgePack, PromptsPack } from "@/lib/ai/knowledge-pack-schema";
import type { AiFeatureKey, AiPromptTemplate, OrganizationAiSettings } from "@/lib/ai/types";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

function requireDb() {
  const db = getAdminDb();
  if (!db) {
    throw new Error("Database is not configured. Set DATABASE_URL.");
  }
  return db;
}

async function loadOrganizationName(organizationId: string): Promise<string | undefined> {
  const org = await getOrganizationServer(organizationId);
  return org?.name?.trim() || undefined;
}

export async function exportKnowledgePackFromStore(input: {
  organizationId: string;
}): Promise<KnowledgePack> {
  const db = requireDb();
  const orgId = input.organizationId.trim();
  if (!orgId) throw new Error("organizationId is required");

  const organizationName = await loadOrganizationName(orgId);
  if (!organizationName) {
    // Org may exist only as document-store tenant; still allow export if libraries exist.
    const orgSnap = await db.collection(COLLECTIONS.organizations).doc(orgId).get();
    if (!orgSnap.exists) {
      throw new Error(`Organization not found: ${orgId}`);
    }
  }

  const orgRef = db.collection(COLLECTIONS.organizations).doc(orgId);

  const [libSnap, docSnap, brandSnap, profileSnap, settingsSnap] = await Promise.all([
    orgRef.collection(ORG_SUBCOLLECTIONS.aiLibraries).get(),
    orgRef.collection(ORG_SUBCOLLECTIONS.aiDocuments).get(),
    db.collection(COLLECTIONS.contentBrands).where("organizationId", "==", orgId).get(),
    db.collection(COLLECTIONS.profiles).where("organizationId", "==", orgId).get(),
    orgRef.collection(ORG_SUBCOLLECTIONS.aiSettings).doc("default").get(),
  ]);

  const libraries = libSnap.docs.map((d) =>
    normalizeLibraryDoc(d.id, (d.data() ?? {}) as Record<string, unknown>),
  );

  const documents = docSnap.docs
    .map((d) => normalizeDocumentDoc(d.id, (d.data() ?? {}) as Record<string, unknown>))
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const brands = brandSnap.docs
    .map((d) => normalizeBrandDoc(d.id, (d.data() ?? {}) as Record<string, unknown>))
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const profileKnowledgeLibraryIds: Record<string, string[]> = {};
  for (const d of profileSnap.docs) {
    const data = (d.data() ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(data.knowledgeLibraryIds)
      ? data.knowledgeLibraryIds.filter((x): x is string => typeof x === "string" && !!x)
      : [];
    if (ids.length) profileKnowledgeLibraryIds[d.id] = ids;
  }

  const settings = settingsSnap.exists
    ? (settingsSnap.data() as Partial<OrganizationAiSettings>)
    : undefined;

  const fitCheckKnowledge = settings?.fitCheckKnowledge
    ? mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge)
    : undefined;

  const embedding =
    settings?.embeddingModel || settings?.embeddingProvider
      ? {
          model: settings.embeddingModel,
          provider: settings.embeddingProvider,
        }
      : undefined;

  return buildKnowledgePack({
    organizationId: orgId,
    organizationName: organizationName ?? undefined,
    libraries,
    documents,
    brands,
    profileKnowledgeLibraryIds,
    fitCheckKnowledge,
    embedding,
  });
}

/** @deprecated Prefer exportKnowledgePackFromStore */
export const exportKnowledgePackFromFirestore = exportKnowledgePackFromStore;

export async function exportPromptsPackFromStore(input: {
  organizationId: string;
}): Promise<PromptsPack> {
  const db = requireDb();
  const orgId = input.organizationId.trim();
  if (!orgId) throw new Error("organizationId is required");

  const organizationName = await loadOrganizationName(orgId);

  // Prefer platform-global prompts; fall back to org overrides (legacy).
  const platformSnap = await db.collection(COLLECTIONS.platformAiPrompts).get();
  const orgSnap = await db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiPrompts)
    .get();

  const storedByFeature: Partial<Record<AiFeatureKey, Partial<AiPromptTemplate>>> = {};

  for (const d of orgSnap.docs) {
    if (!(AI_FEATURE_KEYS as readonly string[]).includes(d.id)) continue;
    const data = d.data() as Partial<AiPromptTemplate>;
    storedByFeature[d.id as AiFeatureKey] = {
      featureKey: d.id as AiFeatureKey,
      systemPrompt: data.systemPrompt,
      userPromptTemplate: data.userPromptTemplate,
      version: data.version,
      updatedAt: data.updatedAt,
    };
  }

  for (const d of platformSnap.docs) {
    if (!(AI_FEATURE_KEYS as readonly string[]).includes(d.id)) continue;
    const data = d.data() as Partial<AiPromptTemplate>;
    storedByFeature[d.id as AiFeatureKey] = {
      featureKey: d.id as AiFeatureKey,
      systemPrompt: data.systemPrompt,
      userPromptTemplate: data.userPromptTemplate,
      version: data.version,
      updatedAt: data.updatedAt,
    };
  }

  return buildPromptsPack({
    organizationId: orgId,
    organizationName,
    storedByFeature,
  });
}

/** @deprecated Prefer exportPromptsPackFromStore */
export const exportPromptsPackFromFirestore = exportPromptsPackFromStore;
