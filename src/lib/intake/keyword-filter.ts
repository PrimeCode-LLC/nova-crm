import type { ScraperRawItem } from "@/lib/types";

export function rawItemSearchHaystack(item: ScraperRawItem): string {
  const snippet =
    item.contentSnippet?.trim() || item.content.replace(/<[^>]+>/g, " ").trim();
  return [item.title, snippet, item.feedName, item.creator, item.dcCreator]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Normalize user-entered keywords: trim, lowercase, dedupe. */
export function normalizeKeywordList(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const kw = raw.trim().toLowerCase();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

/** Split pasted or typed text into individual keywords. */
export function parseKeywordInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function matchesAnyKeyword(haystack: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  return keywords.some((kw) => haystack.includes(kw));
}

/**
 * Include list: when non-empty, item must match at least one keyword.
 * Exclude list: item is hidden when it matches any keyword (exclude wins on overlap).
 */
export function passesKeywordFilters(
  haystack: string,
  includeKeywords: string[],
  excludeKeywords: string[],
): boolean {
  const include = normalizeKeywordList(includeKeywords);
  const exclude = normalizeKeywordList(excludeKeywords);

  if (exclude.length > 0 && matchesAnyKeyword(haystack, exclude)) return false;
  if (include.length > 0 && !matchesAnyKeyword(haystack, include)) return false;
  return true;
}

export function intakeKeywordFiltersActive(
  includeKeywords: string[],
  excludeKeywords: string[],
): boolean {
  return includeKeywords.length > 0 || excludeKeywords.length > 0;
}

/** Combine team defaults with a user's personal keyword lists. */
export function mergeTeamAndPersonalKeywords(
  team: { includeKeywords: string[]; excludeKeywords: string[] },
  personal: { includeKeywords: string[]; excludeKeywords: string[] },
): { includeKeywords: string[]; excludeKeywords: string[] } {
  return {
    includeKeywords: normalizeKeywordList([
      ...team.includeKeywords,
      ...personal.includeKeywords,
    ]),
    excludeKeywords: normalizeKeywordList([
      ...team.excludeKeywords,
      ...personal.excludeKeywords,
    ]),
  };
}
