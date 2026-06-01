import type { Lead, ScraperCategory, ScraperPlatform } from "@/lib/types";

export type LeadScraperSource = {
  link: string;
  feedName?: string;
  platform?: ScraperPlatform;
  category?: ScraperCategory;
  publishedAt?: string;
  rawItemId?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Parse `Link: https://…` from promote-server notes for older rows. */
export function scraperLinkFromLeadNotes(notes: string | undefined): string | undefined {
  if (!notes?.trim()) return undefined;
  const line = notes
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^link:\s*/i.test(l));
  if (!line) return undefined;
  const url = line.replace(/^link:\s*/i, "").trim();
  return url.length > 0 ? url : undefined;
}

/** Scraper intake metadata when the lead was promoted from the intake pool. */
export function getLeadScraperSource(lead: Lead): LeadScraperSource | null {
  const ext = lead.extensions;
  if (isRecord(ext) && isRecord(ext.scraperSource)) {
    const raw = ext.scraperSource;
    const link = optionalString(raw.link) ?? scraperLinkFromLeadNotes(lead.notes);
    if (!link) return null;
    return {
      link,
      feedName: optionalString(raw.feedName),
      platform: optionalString(raw.platform) as ScraperPlatform | undefined,
      category: optionalString(raw.category) as ScraperCategory | undefined,
      publishedAt: optionalString(raw.publishedAt),
      rawItemId: optionalString(raw.rawItemId),
    };
  }
  const link = scraperLinkFromLeadNotes(lead.notes);
  if (!link) return null;
  const sourceLine = lead.notes
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => /^source:/i.test(l));
  const feedMatch = sourceLine?.match(/^source:\s*(.+?)\s*\(/i);
  return {
    link,
    feedName: feedMatch?.[1]?.trim(),
  };
}
