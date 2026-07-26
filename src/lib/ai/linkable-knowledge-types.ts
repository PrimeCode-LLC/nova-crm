import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { AiLibraryAllowedFeature } from "@/lib/ai/types";

export type LinkableKnowledgeDocument = {
  id: string;
  title: string;
  libraryId: string;
  knowledgeSection: KnowledgeSection | null;
  sectionLabel: string;
  chunkCount: number;
};

export type LinkableKnowledgeLibrary = {
  id: string;
  name: string;
  description?: string;
  libraryKind?: string;
  fitCategory?: OpportunitySourceType;
  fitCategoryLabel?: string;
  allowedFeatures: AiLibraryAllowedFeature[];
  documentCount: number;
  chunkCount: number;
  documents: LinkableKnowledgeDocument[];
};

export type LinkableKnowledgeGroup = {
  id: string;
  label: string;
  libraries: LinkableKnowledgeLibrary[];
};
