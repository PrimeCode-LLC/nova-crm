import {
  safeParseKnowledgePack,
  safeParsePromptsPack,
  type KnowledgePack,
  type PromptsPack,
} from "@/lib/ai/knowledge-pack-schema";

export type KnowledgePackPreview = {
  ok: true;
  sourceOrganizationId: string;
  sourceOrganizationName?: string;
  targetOrganizationId: string;
  counts: KnowledgePack["counts"];
  existing: {
    libraries: number;
    documents: number;
    brands: number;
  };
  willUpsert: {
    libraries: number;
    documents: number;
    brands: number;
    profilesWithLibraries: number;
    fitCheckKnowledge: boolean;
  };
};

export type PromptsPackPreview = {
  ok: true;
  sourceOrganizationId: string;
  sourceOrganizationName?: string;
  counts: PromptsPack["counts"];
  overrideFeatureKeys: string[];
};

export function previewKnowledgePack(input: {
  pack: unknown;
  targetOrganizationId: string;
}): KnowledgePackPreview | { ok: false; error: string } {
  const parsed = safeParseKnowledgePack(input.pack);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const pack = parsed.data;
  return {
    ok: true,
    sourceOrganizationId: pack.sourceOrganizationId,
    sourceOrganizationName: pack.sourceOrganizationName,
    targetOrganizationId: input.targetOrganizationId,
    counts: pack.counts,
    existing: { libraries: 0, documents: 0, brands: 0 },
    willUpsert: {
      libraries: pack.libraries.length,
      documents: pack.documents.length,
      brands: pack.brands.length,
      profilesWithLibraries: pack.counts.profilesWithLibraries,
      fitCheckKnowledge: Boolean(pack.fitCheckKnowledge),
    },
  };
}

export function previewPromptsPack(input: {
  pack: unknown;
}): PromptsPackPreview | { ok: false; error: string } {
  const parsed = safeParsePromptsPack(input.pack);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const pack = parsed.data;
  return {
    ok: true,
    sourceOrganizationId: pack.sourceOrganizationId,
    sourceOrganizationName: pack.sourceOrganizationName,
    counts: pack.counts,
    overrideFeatureKeys: pack.prompts.filter((p) => p.source === "override").map((p) => p.featureKey),
  };
}
