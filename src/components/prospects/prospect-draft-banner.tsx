"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FilePenLine, List, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProspectDraft } from "@/lib/prospects/draft-types";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";

type ActiveDraftPage = {
  drafts: ProspectDraft[];
  hasMore: boolean;
};

async function loadActiveDrafts(): Promise<ActiveDraftPage> {
  const response = await fetch("/api/prospect-drafts?status=active&owner=me&limit=100");
  const body = (await response.json()) as {
    drafts?: ProspectDraft[];
    hasMore?: boolean;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not load prospect drafts.");
  return { drafts: body.drafts ?? [], hasMore: Boolean(body.hasMore) };
}

export function ProspectDraftBanner() {
  const { openNewProspectForm } = useOpenQuickAdd();
  const { data } = useQuery({
    queryKey: ["prospect-drafts", "active", "me"],
    queryFn: loadActiveDrafts,
    staleTime: 30_000,
  });
  const draft = data?.drafts[0];
  if (!draft) return null;
  const countLabel = data.hasMore ? `${data.drafts.length}+` : String(data.drafts.length);
  const company = draft.fields.companyName?.value || "Untitled company";
  return (
    <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/8 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FilePenLine className="h-4 w-4 text-amber-600" />
            {countLabel} active prospect {data.drafts.length === 1 && !data.hasMore ? "draft" : "drafts"}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Latest: {company} · {draft.sourceCount} source{draft.sourceCount === 1 ? "" : "s"} ·{" "}
            {draft.missingRequiredFields.length
              ? `Missing ${draft.missingRequiredFields.join(", ")}`
              : "Ready to complete"}
          </p>
          <Progress value={draft.completionPercent} className="mt-2 h-1.5 max-w-md" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            {...(draft.origin === "manual"
              ? {
                  onClick: () =>
                    openNewProspectForm({
                      source: "draft_banner",
                      destination: draft.destination ?? "/prospects",
                      draftId: draft.id,
                    }),
                }
              : {
                  nativeButton: false,
                  render: <Link href={`/prospects/drafts/${draft.id}`} />,
                })}
          >
            <Play className="h-3.5 w-3.5" />
            Resume latest
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/prospects/drafts" />}
          >
            <List className="h-3.5 w-3.5" />
            View drafts
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openNewProspectForm({
                source: "draft_banner",
                destination: "/prospects",
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            New prospect
          </Button>
        </div>
      </div>
    </div>
  );
}
