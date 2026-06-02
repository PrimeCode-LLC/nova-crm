import type { ScraperCategory, ScraperPlatform } from "@/lib/types";

export const SCRAPER_PLATFORM_LABELS: Record<ScraperPlatform, string> = {
  reddit: "Reddit",
  x: "X",
  linkedin: "LinkedIn",
  other: "Other",
};

export const SCRAPER_PLATFORM_PRESETS = Object.keys(SCRAPER_PLATFORM_LABELS) as Array<
  keyof typeof SCRAPER_PLATFORM_LABELS
>;

export function isScraperPlatformPreset(platform: string): platform is keyof typeof SCRAPER_PLATFORM_LABELS {
  return platform in SCRAPER_PLATFORM_LABELS;
}

export function getScraperPlatformLabel(platform: ScraperPlatform | undefined): string {
  const raw = platform?.trim();
  if (!raw) return "Other";
  if (isScraperPlatformPreset(raw)) return SCRAPER_PLATFORM_LABELS[raw];
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export const SCRAPER_CATEGORY_LABELS = {
  hiring: "Hiring",
  problem: "Problem",
  other: "Other",
} as const;

export const SCRAPER_CATEGORY_PRESETS = Object.keys(SCRAPER_CATEGORY_LABELS) as Array<
  keyof typeof SCRAPER_CATEGORY_LABELS
>;

export function isScraperCategoryPreset(category: string): category is keyof typeof SCRAPER_CATEGORY_LABELS {
  return category in SCRAPER_CATEGORY_LABELS;
}

export function getScraperCategoryLabel(category: ScraperCategory | undefined): string {
  const raw = category?.trim();
  if (!raw) return "Other";
  if (isScraperCategoryPreset(raw)) return SCRAPER_CATEGORY_LABELS[raw];
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
