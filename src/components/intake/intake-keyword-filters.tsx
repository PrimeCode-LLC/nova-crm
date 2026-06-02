"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Filter } from "lucide-react";

import { KeywordListInput } from "@/components/intake/keyword-list-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { intakeKeywordFiltersActive } from "@/lib/intake/keyword-filter";
import {
  readIntakeKeywordFilterPrefs,
  writeIntakeKeywordFilterPrefs,
} from "@/lib/intake/keyword-filter-storage";
import { cn } from "@/lib/utils";

export function IntakeKeywordFilters({
  organizationId,
  teamIncludeKeywords,
  teamExcludeKeywords,
  personalIncludeKeywords,
  personalExcludeKeywords,
  onPersonalIncludeChange,
  onPersonalExcludeChange,
  canManageTeamDefaults = false,
  className,
}: {
  organizationId: string | undefined;
  teamIncludeKeywords: string[];
  teamExcludeKeywords: string[];
  personalIncludeKeywords: string[];
  personalExcludeKeywords: string[];
  onPersonalIncludeChange: (next: string[]) => void;
  onPersonalExcludeChange: (next: string[]) => void;
  canManageTeamDefaults?: boolean;
  className?: string;
}) {
  const teamActive = intakeKeywordFiltersActive(teamIncludeKeywords, teamExcludeKeywords);
  const personalActive = intakeKeywordFiltersActive(
    personalIncludeKeywords,
    personalExcludeKeywords,
  );
  const active = teamActive || personalActive;
  const [open, setOpen] = React.useState(active);
  const hydratedOrgRef = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (hydratedOrgRef.current === organizationId) return;
    hydratedOrgRef.current = organizationId;
    const prefs = readIntakeKeywordFilterPrefs(organizationId);
    onPersonalIncludeChange(prefs.personalIncludeKeywords);
    onPersonalExcludeChange(prefs.personalExcludeKeywords);
    if (
      prefs.personalIncludeKeywords.length > 0 ||
      prefs.personalExcludeKeywords.length > 0 ||
      teamIncludeKeywords.length > 0 ||
      teamExcludeKeywords.length > 0
    ) {
      setOpen(true);
    }
  }, [
    organizationId,
    onPersonalIncludeChange,
    onPersonalExcludeChange,
    teamIncludeKeywords.length,
    teamExcludeKeywords.length,
  ]);

  React.useEffect(() => {
    if (hydratedOrgRef.current !== organizationId) return;
    writeIntakeKeywordFilterPrefs(organizationId, {
      personalIncludeKeywords,
      personalExcludeKeywords,
    });
  }, [organizationId, personalIncludeKeywords, personalExcludeKeywords]);

  React.useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const activeCount =
    teamIncludeKeywords.length +
    teamExcludeKeywords.length +
    personalIncludeKeywords.length +
    personalExcludeKeywords.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <CollapsibleTrigger
          render={
            <Button variant="outline" size="sm" type="button" className="gap-1.5 h-9">
              <Filter className="h-3.5 w-3.5" />
              Keyword lists
              {activeCount > 0 ? (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal tabular-nums">
                  {activeCount}
                </Badge>
              ) : null}
              <ChevronDown
                className={cn("h-3 w-3 opacity-60 transition-transform", open && "rotate-180")}
              />
            </Button>
          }
        />
        {personalActive ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="h-9 text-muted-foreground"
            onClick={() => {
              onPersonalIncludeChange([]);
              onPersonalExcludeChange([]);
            }}
          >
            Clear my keywords
          </Button>
        ) : null}
        {canManageTeamDefaults ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="h-9 text-muted-foreground"
            nativeButton={false}
            render={<Link href="/admin/scrapers#team-intake-filters">Manage team defaults</Link>}
          />
        ) : null}
      </div>
      <CollapsibleContent className="pt-3 space-y-3">
        {teamActive ? (
          <p className="text-xs text-muted-foreground">
            Team defaults apply for everyone. Add your own keywords below to filter further.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <KeywordListInput
            id="intake-include-keywords"
            label="Include keywords"
            description="Show posts that contain at least one of these words (title, feed, or content)."
            lockedKeywords={teamIncludeKeywords}
            keywords={personalIncludeKeywords}
            onChange={onPersonalIncludeChange}
            placeholder="e.g. react, senior, remote"
            tone="include"
          />
          <KeywordListInput
            id="intake-exclude-keywords"
            label="Exclude keywords"
            description="Hide posts that contain any of these words. Excludes take priority over includes."
            lockedKeywords={teamExcludeKeywords}
            keywords={personalExcludeKeywords}
            onChange={onPersonalExcludeChange}
            placeholder="e.g. intern, agency, recruiter"
            tone="exclude"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
