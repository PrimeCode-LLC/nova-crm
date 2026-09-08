import { AI_PROMPT_DEFAULTS, promptTemplateIsCurrent } from "@/lib/ai/prompt-defaults";
import {
  AI_FEATURE_KEYS,
  KNOWLEDGE_PACK_FORMAT,
  KNOWLEDGE_PACK_VERSION,
  PROMPTS_PACK_FORMAT,
  PROMPTS_PACK_VERSION,
  type KnowledgePack,
  type KnowledgePackBrand,
  type KnowledgePackDocument,
  type KnowledgePackLibrary,
  type PromptsPack,
  type PromptsPackEntry,
  knowledgePackSchema,
  promptsPackSchema,
} from "@/lib/ai/knowledge-pack-schema";
import type { AiFeatureKey, AiLibraryScope, AiPromptTemplate } from "@/lib/ai/types";
import type { FitCheckKnowledgeConfig } from "@/lib/ai/fit-check-knowledge-types";

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asIso(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: () => Date }).toDate;
    if (typeof toDate === "function") {
      try {
        return toDate().toISOString();
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function normalizeScope(raw: unknown): AiLibraryScope {
  if (!raw || typeof raw !== "object") return { type: "org" };
  const scope = raw as Record<string, unknown>;
  const type = asString(scope.type);
  if (type === "channel" && asString(scope.channelKey)) {
    return { type: "channel", channelKey: asString(scope.channelKey)! };
  }
  if (type === "profile" && asString(scope.profileId)) {
    return { type: "profile", profileId: asString(scope.profileId)! };
  }
  if (type === "campaign" && asString(scope.campaignId)) {
    return { type: "campaign", campaignId: asString(scope.campaignId)! };
  }
  if (type === "content_brand" && asString(scope.brandId)) {
    return { type: "content_brand", brandId: asString(scope.brandId)! };
  }
  return { type: "org" };
}

export function normalizeLibraryDoc(
  id: string,
  data: Record<string, unknown>,
): KnowledgePackLibrary {
  const allowedFeatureSet = new Set([
    "content",
    "outreach",
    "fit_check",
    "intent_radar",
    "lead_ai",
  ] as const);
  const allowed = Array.isArray(data.allowedFeatures)
    ? data.allowedFeatures.filter(
        (f): f is "content" | "outreach" | "fit_check" | "intent_radar" | "lead_ai" =>
          typeof f === "string" && allowedFeatureSet.has(f as never),
      )
    : undefined;

  return {
    id,
    name: asString(data.name) ?? id,
    description: asString(data.description),
    scope: normalizeScope(data.scope),
    documentCount: asNumber(data.documentCount),
    chunkCount: asNumber(data.chunkCount),
    lastIndexedAt: asIso(data.lastIndexedAt),
    createdAt: asIso(data.createdAt),
    updatedAt: asIso(data.updatedAt),
    libraryKind: asString(data.libraryKind),
    fitCategory: asString(data.fitCategory),
    seedSourceUrl: asString(data.seedSourceUrl),
    lastSeededAt: asIso(data.lastSeededAt),
    allowedFeatures: allowed?.length ? allowed : undefined,
  };
}

export function normalizeDocumentDoc(
  id: string,
  data: Record<string, unknown>,
): KnowledgePackDocument | null {
  const libraryId = asString(data.libraryId);
  if (!libraryId) return null;
  const sourceTypeRaw = asString(data.sourceType);
  const sourceType =
    sourceTypeRaw === "script" || sourceTypeRaw === "upload" ? sourceTypeRaw : "markdown";
  return {
    id,
    libraryId,
    title: asString(data.title) ?? id,
    sourceType,
    sourceRef: asString(data.sourceRef),
    content: typeof data.content === "string" ? data.content : "",
    chunkCount: asNumber(data.chunkCount),
    knowledgeSection: asString(data.knowledgeSection),
    createdAt: asIso(data.createdAt),
    updatedAt: asIso(data.updatedAt),
  };
}

export function normalizeBrandDoc(
  id: string,
  data: Record<string, unknown>,
): KnowledgePackBrand | null {
  const name = asString(data.name);
  const kind = asString(data.kind);
  if (!name || !kind) return null;
  const knowledgeLibraryIds = Array.isArray(data.knowledgeLibraryIds)
    ? data.knowledgeLibraryIds.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  const knowledgeDocumentIds = Array.isArray(data.knowledgeDocumentIds)
    ? data.knowledgeDocumentIds.filter((x): x is string => typeof x === "string" && !!x)
    : undefined;

  const rest: Record<string, unknown> = { ...data };
  delete rest.id;
  // Never export secrets if somehow present on brand docs.
  delete rest.apiKey;
  delete rest.secret;
  delete rest.encryptedKey;

  return {
    ...rest,
    id,
    name,
    kind,
    knowledgeLibraryIds,
    knowledgeDocumentIds:
      knowledgeDocumentIds && knowledgeDocumentIds.length > 0 ? knowledgeDocumentIds : undefined,
    active: typeof data.active === "boolean" ? data.active : undefined,
  };
}

export function buildKnowledgePack(input: {
  organizationId: string;
  organizationName?: string;
  libraries: KnowledgePackLibrary[];
  documents: KnowledgePackDocument[];
  brands: KnowledgePackBrand[];
  profileKnowledgeLibraryIds: Record<string, string[]>;
  fitCheckKnowledge?: FitCheckKnowledgeConfig;
  embedding?: { model?: string; provider?: string };
  exportedAt?: string;
}): KnowledgePack {
  const profileEntries = Object.entries(input.profileKnowledgeLibraryIds).filter(
    ([, ids]) => ids.length > 0,
  );
  const pack = {
    format: KNOWLEDGE_PACK_FORMAT,
    version: KNOWLEDGE_PACK_VERSION,
    sourceOrganizationId: input.organizationId,
    sourceOrganizationName: input.organizationName,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    libraries: input.libraries,
    documents: input.documents,
    brands: input.brands,
    links: {
      profileKnowledgeLibraryIds: Object.fromEntries(profileEntries),
    },
    fitCheckKnowledge: input.fitCheckKnowledge,
    embedding: input.embedding,
    counts: {
      libraries: input.libraries.length,
      documents: input.documents.length,
      brands: input.brands.length,
      profilesWithLibraries: profileEntries.length,
    },
  };
  return knowledgePackSchema.parse(pack);
}

export function buildPromptsPack(input: {
  organizationId: string;
  organizationName?: string;
  /** Raw stored prompts from Firestore (may be incomplete). */
  storedByFeature: Partial<Record<AiFeatureKey, Partial<AiPromptTemplate>>>;
  exportedAt?: string;
}): PromptsPack {
  const prompts: PromptsPackEntry[] = [];
  let overrides = 0;
  let defaults = 0;

  for (const featureKey of AI_FEATURE_KEYS) {
    const defaultsPair = AI_PROMPT_DEFAULTS[featureKey];
    const stored = input.storedByFeature[featureKey];
    const storedTemplate = stored?.userPromptTemplate;
    const hasUsableOverride =
      !!stored &&
      typeof stored.systemPrompt === "string" &&
      stored.systemPrompt.trim().length > 0 &&
      typeof storedTemplate === "string" &&
      storedTemplate.trim().length > 0 &&
      promptTemplateIsCurrent(featureKey, storedTemplate);

    if (hasUsableOverride) {
      overrides += 1;
      prompts.push({
        featureKey,
        systemPrompt: stored!.systemPrompt!,
        userPromptTemplate: storedTemplate!,
        version: typeof stored!.version === "number" ? stored!.version : undefined,
        updatedAt: asIso(stored!.updatedAt),
        source: "override",
      });
    } else {
      defaults += 1;
      prompts.push({
        featureKey,
        systemPrompt: defaultsPair.systemPrompt,
        userPromptTemplate: defaultsPair.userPromptTemplate,
        version: typeof stored?.version === "number" ? stored.version : 1,
        updatedAt: asIso(stored?.updatedAt),
        source: "default",
      });
    }
  }

  const pack = {
    format: PROMPTS_PACK_FORMAT,
    version: PROMPTS_PACK_VERSION,
    sourceOrganizationId: input.organizationId,
    sourceOrganizationName: input.organizationName,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    prompts,
    counts: {
      prompts: prompts.length,
      overrides,
      defaults,
    },
  };
  return promptsPackSchema.parse(pack);
}

export function slugifyOrgForFilename(nameOrId: string): string {
  const slug = nameOrId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}
