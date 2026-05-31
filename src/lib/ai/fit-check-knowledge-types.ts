import {
  OPPORTUNITY_SOURCE_TYPES,
  OPPORTUNITY_SOURCE_LABELS,
  type OpportunitySourceType,
} from "@/lib/ai/opportunity-fit-types";

export const FIT_CHECK_LIBRARY_KIND_GLOBAL = "fit_check_global" as const;
export const FIT_CHECK_LIBRARY_KIND_CATEGORY = "fit_check_category" as const;
/** @deprecated Migrated to fit_check_global on re-seed */
export const FIT_CHECK_LIBRARY_KIND_LEGACY = "fit_check_default" as const;

export const KNOWLEDGE_SECTIONS = [
  "icp",
  "services",
  "pricing",
  "case_studies",
  "playbook",
  "website",
  "other",
] as const;

export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

export const KNOWLEDGE_SECTION_LABELS: Record<KnowledgeSection, string> = {
  icp: "ICP & positioning",
  services: "Services & delivery",
  pricing: "Pricing & commercial",
  case_studies: "Case studies & proof",
  playbook: "Category playbook",
  website: "Website page",
  other: "Other",
};

export interface FitCheckCategoryKnowledgeConfig {
  /** Use this category's dedicated library in retrieval. */
  enabled: boolean;
  /** When true, also pull chunks from the global library (no duplicate embeddings). */
  useGlobal: boolean;
  libraryId?: string;
}

export interface FitCheckRetrievalBudget {
  /** Max chunks from global library per fit check (controls prompt size + cost). */
  globalChunks: number;
  /** Max chunks from category library per fit check. */
  categoryChunks: number;
}

export interface FitCheckKnowledgeConfig {
  globalLibraryId?: string;
  /** Master switch — when false, global library is never queried even if useGlobal is on. */
  globalEnabled: boolean;
  categories: Record<OpportunitySourceType, FitCheckCategoryKnowledgeConfig>;
  retrievalBudget: FitCheckRetrievalBudget;
}

export const DEFAULT_FIT_CHECK_RETRIEVAL_BUDGET: FitCheckRetrievalBudget = {
  globalChunks: 5,
  categoryChunks: 4,
};

export function defaultFitCheckKnowledgeConfig(): FitCheckKnowledgeConfig {
  const categories = {} as Record<OpportunitySourceType, FitCheckCategoryKnowledgeConfig>;
  for (const key of OPPORTUNITY_SOURCE_TYPES) {
    categories[key] = {
      enabled: true,
      useGlobal: true,
    };
  }
  return {
    globalEnabled: true,
    categories,
    retrievalBudget: { ...DEFAULT_FIT_CHECK_RETRIEVAL_BUDGET },
  };
}

export function mergeFitCheckKnowledgeConfig(
  raw: Partial<FitCheckKnowledgeConfig> | undefined,
): FitCheckKnowledgeConfig {
  const base = defaultFitCheckKnowledgeConfig();
  if (!raw) return base;

  const categories = { ...base.categories };
  if (raw.categories) {
    for (const key of OPPORTUNITY_SOURCE_TYPES) {
      categories[key] = {
        ...base.categories[key],
        ...raw.categories[key],
      };
    }
  }

  return {
    globalLibraryId: raw.globalLibraryId ?? base.globalLibraryId,
    globalEnabled: raw.globalEnabled ?? base.globalEnabled,
    categories,
    retrievalBudget: {
      ...base.retrievalBudget,
      ...raw.retrievalBudget,
    },
  };
}

export { OPPORTUNITY_SOURCE_LABELS, OPPORTUNITY_SOURCE_TYPES, type OpportunitySourceType };
