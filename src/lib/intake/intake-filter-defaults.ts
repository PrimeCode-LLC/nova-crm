import { normalizeKeywordList } from "@/lib/intake/keyword-filter";
import type { OrganizationIntakeFilterDefaults } from "@/lib/types";

export const EMPTY_INTAKE_FILTER_DEFAULTS: OrganizationIntakeFilterDefaults = {
  includeKeywords: [],
  excludeKeywords: [],
};

export function parseIntakeFilterDefaults(raw: unknown): OrganizationIntakeFilterDefaults {
  if (!raw || typeof raw !== "object") return { ...EMPTY_INTAKE_FILTER_DEFAULTS };
  const o = raw as Record<string, unknown>;
  const includeRaw = Array.isArray(o.includeKeywords) ? o.includeKeywords : [];
  const excludeRaw = Array.isArray(o.excludeKeywords) ? o.excludeKeywords : [];
  return {
    includeKeywords: normalizeKeywordList(
      includeRaw.filter((k): k is string => typeof k === "string"),
    ),
    excludeKeywords: normalizeKeywordList(
      excludeRaw.filter((k): k is string => typeof k === "string"),
    ),
  };
}

export function mergeKeywordLists(...lists: string[][]): string[] {
  return normalizeKeywordList(lists.flat());
}
