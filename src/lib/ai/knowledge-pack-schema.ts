import { z } from "zod";
import type { AiFeatureKey } from "@/lib/ai/types";

/** Portable org RAG corpus (libraries, docs, brands, links). No prompts, no secrets. */
export const KNOWLEDGE_PACK_FORMAT = "nova-knowledge-pack" as const;
export const KNOWLEDGE_PACK_VERSION = 1 as const;

/** Platform-wide prompt templates (global for now). */
export const PROMPTS_PACK_FORMAT = "nova-prompts-pack" as const;
export const PROMPTS_PACK_VERSION = 1 as const;

export const AI_FEATURE_KEYS = [
  "dashboard_brief",
  "lead_analyze",
  "intent_suggest",
  "followup_suggest",
  "email_reply",
  "email_reply_classify",
  "prospect_draft_extract",
  "opportunity_fit",
  "opportunity_fit_discuss",
  "intent_radar_evaluate",
  "content_capture_normalize",
  "content_plan_suggest",
  "content_draft_generate",
  "content_graphics_brief",
  "rag_index",
] as const satisfies readonly AiFeatureKey[];

export const aiFeatureKeySchema = z.enum(AI_FEATURE_KEYS);

const libraryScopeSchema = z.union([
  z.object({ type: z.literal("org") }),
  z.object({ type: z.literal("channel"), channelKey: z.string() }),
  z.object({ type: z.literal("profile"), profileId: z.string() }),
  z.object({ type: z.literal("campaign"), campaignId: z.string() }),
  z.object({ type: z.literal("content_brand"), brandId: z.string() }),
]);

const allowedFeatureSchema = z.enum([
  "content",
  "outreach",
  "fit_check",
  "intent_radar",
  "lead_ai",
]);

export const knowledgePackLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: libraryScopeSchema,
  documentCount: z.number().int().nonnegative().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  lastIndexedAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  libraryKind: z.string().optional(),
  fitCategory: z.string().optional(),
  seedSourceUrl: z.string().optional(),
  lastSeededAt: z.string().optional(),
  allowedFeatures: z.array(allowedFeatureSchema).optional(),
});

export const knowledgePackDocumentSchema = z.object({
  id: z.string().min(1),
  libraryId: z.string().min(1),
  title: z.string(),
  sourceType: z.enum(["markdown", "script", "upload"]),
  sourceRef: z.string().optional(),
  content: z.string(),
  chunkCount: z.number().int().nonnegative().optional(),
  knowledgeSection: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** Content brand payload; keep ids + knowledge links stable for re-import. */
export const knowledgePackBrandSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    knowledgeLibraryIds: z.array(z.string()).default([]),
    knowledgeDocumentIds: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

const fitCheckCategorySchema = z.object({
  enabled: z.boolean(),
  useGlobal: z.boolean(),
  libraryId: z.string().optional(),
});

export const knowledgePackFitCheckSchema = z.object({
  globalLibraryId: z.string().optional(),
  globalEnabled: z.boolean(),
  categories: z.record(z.string(), fitCheckCategorySchema),
  retrievalBudget: z.object({
    globalChunks: z.number().int().positive(),
    categoryChunks: z.number().int().positive(),
  }),
});

export const knowledgePackSchema = z.object({
  format: z.literal(KNOWLEDGE_PACK_FORMAT),
  version: z.literal(KNOWLEDGE_PACK_VERSION),
  sourceOrganizationId: z.string().min(1),
  sourceOrganizationName: z.string().optional(),
  exportedAt: z.string().min(1),
  libraries: z.array(knowledgePackLibrarySchema),
  documents: z.array(knowledgePackDocumentSchema),
  brands: z.array(knowledgePackBrandSchema),
  links: z.object({
    profileKnowledgeLibraryIds: z.record(z.string(), z.array(z.string())),
  }),
  fitCheckKnowledge: knowledgePackFitCheckSchema.optional(),
  embedding: z
    .object({
      model: z.string().optional(),
      provider: z.string().optional(),
    })
    .optional(),
  counts: z.object({
    libraries: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    brands: z.number().int().nonnegative(),
    profilesWithLibraries: z.number().int().nonnegative(),
  }),
});

export type KnowledgePack = z.infer<typeof knowledgePackSchema>;
export type KnowledgePackLibrary = z.infer<typeof knowledgePackLibrarySchema>;
export type KnowledgePackDocument = z.infer<typeof knowledgePackDocumentSchema>;
export type KnowledgePackBrand = z.infer<typeof knowledgePackBrandSchema>;

export const promptsPackEntrySchema = z.object({
  featureKey: aiFeatureKeySchema,
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  version: z.number().int().positive().optional(),
  updatedAt: z.string().optional(),
  /** override = saved under source org; default = from code defaults */
  source: z.enum(["override", "default"]),
});

export const promptsPackSchema = z.object({
  format: z.literal(PROMPTS_PACK_FORMAT),
  version: z.literal(PROMPTS_PACK_VERSION),
  /** Org whose Firestore aiPrompts overrides were read (informational). */
  sourceOrganizationId: z.string().min(1),
  sourceOrganizationName: z.string().optional(),
  exportedAt: z.string().min(1),
  prompts: z.array(promptsPackEntrySchema),
  counts: z.object({
    prompts: z.number().int().nonnegative(),
    overrides: z.number().int().nonnegative(),
    defaults: z.number().int().nonnegative(),
  }),
});

export type PromptsPack = z.infer<typeof promptsPackSchema>;
export type PromptsPackEntry = z.infer<typeof promptsPackEntrySchema>;

export function parseKnowledgePack(data: unknown): KnowledgePack {
  return knowledgePackSchema.parse(data);
}

export function parsePromptsPack(data: unknown): PromptsPack {
  return promptsPackSchema.parse(data);
}

export function safeParseKnowledgePack(data: unknown) {
  return knowledgePackSchema.safeParse(data);
}

export function safeParsePromptsPack(data: unknown) {
  return promptsPackSchema.safeParse(data);
}
