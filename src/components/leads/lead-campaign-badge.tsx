"use client";

import Link from "next/link";
import { Mail } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shows which Instantly outreach campaign a lead or prospect was pushed to. */
export function LeadCampaignBadge({
  lead,
  className,
  link = true,
}: {
  lead: Lead;
  className?: string;
  /** When false, render the badge without linking to the campaign page. */
  link?: boolean;
}) {
  const { getCampaignById } = useWorkspace();
  const campaignId = lead.campaignId?.trim();
  if (!campaignId) return null;

  const campaign = getCampaignById(campaignId);
  const label = campaign?.name?.trim() || `Campaign ${campaignId.slice(0, 10)}…`;
  const pushed = lead.pushToInstantly === "pushed";

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "max-w-[11rem] truncate gap-1 rounded-md text-[10px] font-normal",
        pushed
          ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200"
          : "text-muted-foreground",
        className,
      )}
      title={pushed ? `Sent to Instantly: ${label}` : label}
    >
      <Mail className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      <span className="truncate">{label}</span>
    </Badge>
  );

  if (!link) return badge;

  return (
    <Link
      href={`/outreach/${campaignId}`}
      className="inline-flex min-w-0 hover:opacity-90"
      title={`Open campaign: ${label}`}
    >
      {badge}
    </Link>
  );
}
