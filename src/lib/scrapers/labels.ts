import type { ScraperCategory, ScraperPlatform } from "@/lib/types";

export const SCRAPER_PLATFORM_LABELS = {
  reddit: "Reddit",
  x: "X",
  linkedin: "LinkedIn",
  other: "Other",
} as const;

export type ScraperPlatformPreset = keyof typeof SCRAPER_PLATFORM_LABELS;

export const SCRAPER_PLATFORM_PRESETS = Object.keys(SCRAPER_PLATFORM_LABELS) as ScraperPlatformPreset[];

export function isScraperPlatformPreset(platform: string): platform is ScraperPlatformPreset {
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

export type ScraperCategoryPreset = keyof typeof SCRAPER_CATEGORY_LABELS;

export const SCRAPER_CATEGORY_PRESETS = Object.keys(SCRAPER_CATEGORY_LABELS) as ScraperCategoryPreset[];

export function isScraperCategoryPreset(category: string): category is ScraperCategoryPreset {
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
