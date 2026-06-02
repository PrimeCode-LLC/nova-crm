const STORAGE_PREFIX = "nova-crm-intake-keyword-filters";

export type IntakeKeywordFilterPrefs = {
  /** User-specific additions on top of team defaults. */
  personalIncludeKeywords: string[];
  personalExcludeKeywords: string[];
};

function normalizePrefs(parsed: Partial<IntakeKeywordFilterPrefs> & Record<string, unknown>): IntakeKeywordFilterPrefs {
  const legacyInclude = Array.isArray(parsed.includeKeywords)
    ? parsed.includeKeywords.filter((k): k is string => typeof k === "string")
    : [];
  const legacyExclude = Array.isArray(parsed.excludeKeywords)
    ? parsed.excludeKeywords.filter((k): k is string => typeof k === "string")
    : [];
  return {
    personalIncludeKeywords: Array.isArray(parsed.personalIncludeKeywords)
      ? parsed.personalIncludeKeywords.filter((k): k is string => typeof k === "string")
      : legacyInclude,
    personalExcludeKeywords: Array.isArray(parsed.personalExcludeKeywords)
      ? parsed.personalExcludeKeywords.filter((k): k is string => typeof k === "string")
      : legacyExclude,
  };
}

function storageKey(organizationId: string | undefined): string {
  return `${STORAGE_PREFIX}:${organizationId ?? "default"}`;
}

export function readIntakeKeywordFilterPrefs(
  organizationId: string | undefined,
): IntakeKeywordFilterPrefs {
  if (typeof window === "undefined") {
    return { personalIncludeKeywords: [], personalExcludeKeywords: [] };
  }
  try {
    const raw = localStorage.getItem(storageKey(organizationId));
    if (!raw) return { personalIncludeKeywords: [], personalExcludeKeywords: [] };
    const parsed = JSON.parse(raw) as Partial<IntakeKeywordFilterPrefs> & Record<string, unknown>;
    return normalizePrefs(parsed);
  } catch {
    return { personalIncludeKeywords: [], personalExcludeKeywords: [] };
  }
}

export function writeIntakeKeywordFilterPrefs(
  organizationId: string | undefined,
  prefs: IntakeKeywordFilterPrefs,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(organizationId), JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}
