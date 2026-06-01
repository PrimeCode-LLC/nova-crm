"use client";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Lead } from "@/lib/types";
import { getLeadScraperSource } from "@/lib/scrapers/lead-scraper-source";
import {
  SCRAPER_CATEGORY_LABELS,
  SCRAPER_PLATFORM_LABELS,
} from "@/lib/scrapers/labels";
import { cn } from "@/lib/utils";

export function useLeadScraperSource(lead: Lead | undefined) {
  return lead ? getLeadScraperSource(lead) : null;
}

export function LeadSourceButton({
  lead,
  variant = "outline",
  size = "sm",
  className,
}: {
  lead: Lead;
  variant?: "outline" | "ghost" | "default";
  size?: "sm" | "default";
  className?: string;
}) {
  const source = getLeadScraperSource(lead);
  if (!source?.link) return null;

  return (
    <Button
      variant={variant}
      size={size}
      className={cn("gap-1.5", className)}
      nativeButton={false}
      render={
        <a href={source.link} target="_blank" rel="noopener noreferrer" title={source.link}>
          <ExternalLink className="h-3.5 w-3.5" /> Source
        </a>
      }
    />
  );
}

export function LeadScraperSourceSummary({ lead }: { lead: Lead }) {
  const source = getLeadScraperSource(lead);
  if (!source) return null;

  const platformLabel =
    source.platform && source.platform in SCRAPER_PLATFORM_LABELS
      ? SCRAPER_PLATFORM_LABELS[source.platform]
      : null;
  const categoryLabel =
    source.category && source.category in SCRAPER_CATEGORY_LABELS
      ? SCRAPER_CATEGORY_LABELS[source.category]
      : null;

  return (
    <p className="text-xs text-muted-foreground">
      {source.feedName ? (
        <span className="font-medium text-foreground">{source.feedName}</span>
      ) : (
        <span>Scraper intake</span>
      )}
      {platformLabel ? <> · {platformLabel}</> : null}
      {categoryLabel ? <> · {categoryLabel}</> : null}
    </p>
  );
}
