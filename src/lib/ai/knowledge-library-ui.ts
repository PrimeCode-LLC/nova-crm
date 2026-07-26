/**
 * Display helpers for org knowledge libraries.
 * Maps legacy Fit Check–centric kinds/names to feature-agnostic product language.
 */

import type { AiLibraryAllowedFeature } from "@/lib/ai/types";

export type KnowledgeLibraryUiType = "company" | "channel" | "brand" | "topic";

/** @deprecated Prefer AiLibraryAllowedFeature — kept as alias for existing imports. */
export type KnowledgeConsumerId = AiLibraryAllowedFeature;

export const KNOWLEDGE_CONSUMER_LABELS: Record<AiLibraryAllowedFeature, string> = {
  content: "Content calendar",
  outreach: "Email / sequences",
  fit_check: "Fit Check",
  intent_radar: "Intent Radar",
  lead_ai: "Lead AI",
};

export const ALL_LIBRARY_FEATURES: AiLibraryAllowedFeature[] = [
  "content",
  "outreach",
  "fit_check",
  "intent_radar",
  "lead_ai",
];

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeLibraryUiType, string> = {
  company: "Company",
  channel: "Channel",
  brand: "Brand pack",
  topic: "Topic",
};

type LibraryLike = {
  name?: string;
  libraryKind?: string;
  fitCategory?: string;
  scope?: { type?: string; brandId?: string };
  allowedFeatures?: AiLibraryAllowedFeature[] | string[] | null;
};

export function resolveKnowledgeLibraryType(lib: LibraryLike): KnowledgeLibraryUiType {
  const kind = lib.libraryKind ?? "";
  if (kind === "fit_check_global" || kind === "fit_check_default") return "company";
  if (kind === "fit_check_category") return "channel";
  if (kind === "content_brand" || lib.scope?.type === "content_brand") return "brand";
  if (lib.name?.startsWith("Content · ") || lib.name?.startsWith("Content - ")) return "brand";
  return "topic";
}

/** Friendly display name; remaps legacy "Sales knowledge, …" labels. */
export function displayKnowledgeLibraryName(lib: LibraryLike): string {
  const type = resolveKnowledgeLibraryType(lib);
  const raw = (lib.name ?? "").trim();

  if (type === "company") {
    if (
      !raw ||
      /^Sales knowledge,\s*Global/i.test(raw) ||
      /^Global knowledge/i.test(raw)
    ) {
      return "Company knowledge";
    }
    return raw.replace(/^Sales knowledge,\s*Global\s*\(company\)\s*$/i, "Company knowledge");
  }

  if (type === "channel") {
    const fromPrefix = raw.replace(/^Sales knowledge,\s*/i, "").trim();
    if (fromPrefix && fromPrefix !== raw) return `Channel · ${fromPrefix}`;
    if (lib.fitCategory) {
      const label = lib.fitCategory.replace(/_/g, " ");
      return `Channel · ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
    }
  }

  if (type === "brand") {
    return raw.replace(/^Content\s*[-·]\s*/i, "Brand pack · ");
  }

  return raw || "Untitled library";
}

/** Default allowlist when `allowedFeatures` is missing on a library doc. */
export function defaultAllowedFeaturesForLibraryType(
  type: KnowledgeLibraryUiType,
): AiLibraryAllowedFeature[] {
  switch (type) {
    case "company":
      return [...ALL_LIBRARY_FEATURES];
    case "channel":
      return ["fit_check", "intent_radar"];
    case "brand":
      // Brand packs are Content-only; brands link them for calendar / Capture.
      return ["content"];
    case "topic":
      return ["content", "outreach", "fit_check", "lead_ai"];
  }
}

/** @deprecated Use defaultAllowedFeaturesForLibraryType */
export function consumersForLibraryType(type: KnowledgeLibraryUiType): AiLibraryAllowedFeature[] {
  return defaultAllowedFeaturesForLibraryType(type);
}

function normalizeFeatureList(
  raw: AiLibraryAllowedFeature[] | string[] | null | undefined,
): AiLibraryAllowedFeature[] | null {
  if (!raw?.length) return null;
  const allowed = new Set<string>(ALL_LIBRARY_FEATURES);
  const out: AiLibraryAllowedFeature[] = [];
  for (const f of raw) {
    if (allowed.has(f) && !out.includes(f as AiLibraryAllowedFeature)) {
      out.push(f as AiLibraryAllowedFeature);
    }
  }
  return out.length ? out : null;
}

/** Effective allowlist: stored value, or type defaults for legacy docs. */
export function resolveAllowedFeatures(lib: LibraryLike): AiLibraryAllowedFeature[] {
  const stored = normalizeFeatureList(lib.allowedFeatures);
  if (stored) return stored;
  return defaultAllowedFeaturesForLibraryType(resolveKnowledgeLibraryType(lib));
}

export function libraryAllowsFeature(
  lib: LibraryLike,
  feature: AiLibraryAllowedFeature,
): boolean {
  return resolveAllowedFeatures(lib).includes(feature);
}

export function knowledgeTypeBadgeVariant(
  type: KnowledgeLibraryUiType,
): "default" | "secondary" | "outline" {
  if (type === "company") return "default";
  if (type === "brand") return "secondary";
  return "outline";
}

/** Suggested display name when seeding new company/channel libraries. */
export const COMPANY_LIBRARY_DISPLAY_NAME = "Company knowledge";
export const CHANNEL_LIBRARY_NAME_PREFIX = "Channel · ";
