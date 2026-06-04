"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  OPPORTUNITY_SOURCE_LABELS,
  OPPORTUNITY_SOURCE_TYPES,
  type OpportunitySourceType,
} from "@/lib/ai/opportunity-fit-types";
import { defaultFitCategoriesForChannel } from "@/lib/ai/profile-fit-check";
import type { ChannelKey } from "@/lib/types";
import { ProfileKnowledgePicker } from "@/components/admin/profile-knowledge-picker";

export function ProfileFitCheckFields({
  channel,
  stackLabel,
  onStackLabelChange,
  fitCheckCategories,
  onFitCheckCategoriesChange,
  knowledgeLibraryIds,
  onKnowledgeLibraryIdsChange,
  knowledgeDocumentIds,
  onKnowledgeDocumentIdsChange,
}: {
  channel: ChannelKey;
  stackLabel: string;
  onStackLabelChange: (v: string) => void;
  fitCheckCategories: OpportunitySourceType[];
  onFitCheckCategoriesChange: (v: OpportunitySourceType[]) => void;
  knowledgeLibraryIds: string[];
  onKnowledgeLibraryIdsChange: (v: string[]) => void;
  knowledgeDocumentIds: string[];
  onKnowledgeDocumentIdsChange: (v: string[]) => void;
}) {
  const channelDefaults = defaultFitCategoriesForChannel(channel);

  function toggleCategory(cat: OpportunitySourceType) {
    const next = fitCheckCategories.includes(cat)
      ? fitCheckCategories.filter((c) => c !== cat)
      : [...fitCheckCategories, cat];
    onFitCheckCategoriesChange(next);
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">Fit Check</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Choose opportunity types for this persona, then select libraries or individual documents
          (e.g. MERN Stack under Job / application playbook).
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Stack label (optional)</Label>
        <Input
          className="h-9"
          placeholder="e.g. MERN, .NET, US Upwork"
          value={stackLabel}
          onChange={(e) => onStackLabelChange(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Opportunity categories</Label>
        <p className="text-[10px] text-muted-foreground">
          Empty = use channel defaults (
          {channelDefaults.map((c) => OPPORTUNITY_SOURCE_LABELS[c]).join(", ")}).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {OPPORTUNITY_SOURCE_TYPES.map((cat) => {
            const on = fitCheckCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {OPPORTUNITY_SOURCE_LABELS[cat]}
              </button>
            );
          })}
        </div>
      </div>

      <ProfileKnowledgePicker
        knowledgeLibraryIds={knowledgeLibraryIds}
        knowledgeDocumentIds={knowledgeDocumentIds}
        onKnowledgeLibraryIdsChange={onKnowledgeLibraryIdsChange}
        onKnowledgeDocumentIdsChange={onKnowledgeDocumentIdsChange}
      />
    </div>
  );
}

export function ProfileFitCheckBadges({
  stackLabel,
  fitCheckCategories,
  knowledgeLibraryCount,
  knowledgeDocumentCount,
}: {
  stackLabel?: string;
  fitCheckCategories?: OpportunitySourceType[];
  knowledgeLibraryCount?: number;
  knowledgeDocumentCount?: number;
}) {
  if (
    !stackLabel &&
    !fitCheckCategories?.length &&
    !knowledgeLibraryCount &&
    !knowledgeDocumentCount
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {stackLabel ? (
        <Badge variant="secondary" className="text-[10px] font-normal">
          {stackLabel}
        </Badge>
      ) : null}
      {fitCheckCategories?.slice(0, 2).map((c) => (
        <Badge key={c} variant="outline" className="text-[10px] font-normal">
          {OPPORTUNITY_SOURCE_LABELS[c]}
        </Badge>
      ))}
      {fitCheckCategories && fitCheckCategories.length > 2 ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          +{fitCheckCategories.length - 2}
        </Badge>
      ) : null}
      {knowledgeLibraryCount ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          {knowledgeLibraryCount} lib
        </Badge>
      ) : null}
      {knowledgeDocumentCount ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          {knowledgeDocumentCount} doc
        </Badge>
      ) : null}
    </div>
  );
}
