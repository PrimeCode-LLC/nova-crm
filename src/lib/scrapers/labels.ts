import type { ScraperCategory, ScraperPlatform } from "@/lib/types";

export const SCRAPER_PLATFORM_LABELS: Record<ScraperPlatform, string> = {
  reddit: "Reddit",
  x: "X",
  linkedin: "LinkedIn",
  other: "Other",
};

export const SCRAPER_CATEGORY_LABELS: Record<ScraperCategory, string> = {
  hiring: "Hiring",
  problem: "Problem",
  other: "Other",
};
