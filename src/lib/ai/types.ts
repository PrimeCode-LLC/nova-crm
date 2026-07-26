import type { FitCheckKnowledgeConfig } from "@/lib/ai/fit-check-knowledge-types";
import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type { Role } from "@/lib/types";

export type AiProvider = "openai" | "anthropic" | "google";

export type AiFeatureKey =
  | "dashboard_brief"
  | "lead_analyze"
  | "intent_suggest"
  | "followup_suggest"
  | "email_reply"
  | "prospect_draft_extract"
  | "opportunity_fit"
  | "opportunity_fit_discuss"
  | "intent_radar_evaluate"
  | "content_capture_normalize"
  | "content_plan_suggest"
  | "content_draft_generate"
  | "content_graphics_brief"
  | "rag_index";

export type AiRagMode = "strict" | "reference" | "open";

export type AiLibraryScope =
  | { type: "org" }
  | { type: "channel"; channelKey: string }
  | { type: "profile"; profileId: string }
  | { type: "campaign"; campaignId: string }
  | { type: "content_brand"; brandId: string };

export interface AiFeatureConfig {
  enabled: boolean;
  provider?: AiProvider;
  model?: string;
  ragMode?: AiRagMode;
  libraryIds?: string[];
  allowedRoles?: Role[];
}

export interface OrganizationAiSettings {
  enabled: boolean;
  defaultProvider: AiProvider;
  defaultModel: string;
  dailyTokenCap?: number;
  features: Record<AiFeatureKey, AiFeatureConfig>;
  embeddingModel?: string;
  embeddingProvider?: AiProvider;
  /** Layered Fit Check RAG: global + per-category libraries with connect toggles. */
  fitCheckKnowledge?: FitCheckKnowledgeConfig;
  updatedAt?: string;
}

export interface AiProviderKeyFlags {
  openai: boolean;
  anthropic: boolean;
  google: boolean;
}

export interface AiPromptTemplate {
  featureKey: AiFeatureKey;
  systemPrompt: string;
  userPromptTemplate: string;
  version: number;
  updatedAt?: string;
}

/**
 * Product surfaces that may retrieve from a knowledge library.
 * Brands (Content) and outreach profiles pick among libraries that allow each surface.
 */
export type AiLibraryAllowedFeature =
  | "content"
  | "outreach"
  | "fit_check"
  | "intent_radar"
  | "lead_ai";

export interface AiKnowledgeLibrary {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  scope: AiLibraryScope;
  documentCount: number;
  chunkCount: number;
  lastIndexedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** System libraries (fit_check_global, fit_check_category, legacy fit_check_default). */
  libraryKind?: string;
  /** For fit_check_category libraries. */
  fitCategory?: string;
  seedSourceUrl?: string;
  lastSeededAt?: string;
  /**
   * Which product surfaces may link / retrieve this library.
   * When omitted, defaults are inferred from library type (company / channel / brand pack / topic).
   */
  allowedFeatures?: AiLibraryAllowedFeature[];
}

export interface AiKnowledgeDocument {
  id: string;
  organizationId: string;
  libraryId: string;
  title: string;
  sourceType: "markdown" | "script" | "upload";
  sourceRef?: string;
  content: string;
  chunkCount: number;
  knowledgeSection?: KnowledgeSection;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageEvent {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  feature: AiFeatureKey | "rag_index";
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
  filterHash?: string;
  leadId?: string;
  createdAt: string;
}

export interface AiUsageDailyRollup {
  date: string;
  organizationId: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byFeature: Record<string, { requests: number; inputTokens: number; outputTokens: number }>;
  byUser: Record<
    string,
    {
      displayName?: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
}

export interface UserAiPreferences {
  tone?: "professional" | "friendly" | "concise";
  extraInstructions?: string;
  saveAnalysisToTimeline?: boolean;
}

export const DEFAULT_AI_SETTINGS: OrganizationAiSettings = {
  enabled: false,
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
  embeddingModel: "text-embedding-3-small",
  embeddingProvider: "openai",
  features: {
    dashboard_brief: {
      enabled: true,
      ragMode: "open",
      allowedRoles: ["director", "manager", "team_lead"],
    },
    lead_analyze: {
      enabled: true,
      ragMode: "reference",
    },
    intent_suggest: {
      enabled: true,
      ragMode: "open",
    },
    followup_suggest: {
      enabled: true,
      ragMode: "reference",
    },
    email_reply: {
      enabled: true,
      ragMode: "reference",
    },
    prospect_draft_extract: {
      enabled: true,
      ragMode: "strict",
    },
    opportunity_fit: {
      enabled: true,
      ragMode: "strict",
    },
    opportunity_fit_discuss: {
      enabled: true,
      ragMode: "reference",
    },
    intent_radar_evaluate: {
      enabled: true,
      ragMode: "strict",
    },
    content_capture_normalize: {
      enabled: true,
      ragMode: "open",
    },
    content_plan_suggest: {
      enabled: true,
      ragMode: "reference",
    },
    content_draft_generate: {
      enabled: true,
      ragMode: "reference",
    },
    content_graphics_brief: {
      enabled: true,
      ragMode: "reference",
    },
    rag_index: {
      enabled: true,
    },
  },
};
