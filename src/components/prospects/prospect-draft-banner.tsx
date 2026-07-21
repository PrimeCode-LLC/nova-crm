"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FilePenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProspectDraft } from "@/lib/prospects/draft-types";

async function loadActiveDrafts(): Promise<ProspectDraft[]> {
  const response = await fetch("/api/prospect-drafts?status=active&owner=me");
  const body = (await response.json()) as { drafts?: ProspectDraft[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not load prospect drafts.");
  return body.drafts ?? [];
}

export function ProspectDraftBanner() {
  const { data } = useQuery({
    queryKey: ["prospect-drafts", "active", "me"],
    queryFn: loadActiveDrafts,
    staleTime: 30_000,
  });
  const draft = data?.[0];
  if (!draft) return null;
  const company = draft.fields.companyName?.value || "Untitled company";
  return (
    <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/8 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FilePenLine className="h-4 w-4 text-amber-600" />
            Finish your working draft before starting another
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {company} · {draft.sourceCount} source{draft.sourceCount === 1 ? "" : "s"} ·{" "}
            {draft.missingRequiredFields.length
              ? `Missing ${draft.missingRequiredFields.join(", ")}`
              : "Ready to complete"}
          </p>
          <Progress value={draft.completionPercent} className="mt-2 h-1.5 max-w-md" />
        </div>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link href={`/prospects/drafts/${draft.id}`}>
              <Plus className="h-3.5 w-3.5" />
              Continue draft
            </Link>
          }
        />
      </div>
    </div>
  );
}
