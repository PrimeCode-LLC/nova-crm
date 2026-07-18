"use client";

import * as React from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { densityLabel, resolveLeadQuality } from "@/lib/intent/compute-quality-score";
import { labelNamesForLead } from "@/lib/intent/apply-quality-score";
import type { IntentPlaybook } from "@/lib/intent/types";
import type { CrmLabel, Lead } from "@/lib/types";
import { TEMPERATURE_TONE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

export function LeadIntentQualityCard({
  lead,
  playbook,
  crmLabels,
  canEdit,
}: {
  lead: Lead;
  playbook: IntentPlaybook;
  crmLabels: readonly CrmLabel[];
  canEdit: boolean;
}) {
  const ws = useWorkspace();
  const [suggesting, setSuggesting] = React.useState(false);
  const result = resolveLeadQuality(lead, playbook, labelNamesForLead(lead, crmLabels));
  const temp = TEMPERATURE_TONE[result.suggestedTemperature];

  const onSuggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/ai/intent-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          ...(ws.isDemo
            ? {
                demoContext: {
                  lead: lead as unknown as Record<string, unknown>,
                },
              }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        suggestions?: { field: string; value: string; signalLabel: string }[];
      };
      if (!res.ok) {
        toast.error(data.error || "Could not suggest signals");
        return;
      }
      const suggestions = data.suggestions ?? [];
      if (!suggestions.length) {
        toast.message("No new signal suggestions", {
          description: "Research fields already cover the playbook, or there is little to infer.",
        });
        return;
      }
      const patch: Partial<Lead> = {};
      for (const s of suggestions) {
        if (s.field === "hiringSignals" && !lead.hiringSignals?.trim()) {
          patch.hiringSignals = s.value;
        } else if (s.field === "triggerEvent" && !lead.triggerEvent?.trim()) {
          patch.triggerEvent = s.value;
        } else if (s.field === "painPoints" && !lead.painPoints?.trim()) {
          patch.painPoints = s.value;
        } else if (s.field === "recentNews" && !lead.recentNews?.trim()) {
          patch.recentNews = s.value;
        } else if (s.field === "businessFocus" && !lead.businessFocus?.trim()) {
          patch.businessFocus = s.value;
        }
      }
      if (Object.keys(patch).length === 0) {
        toast.message("Suggestions found", {
          description: suggestions.map((s) => `${s.signalLabel}: ${s.value}`).join(" · "),
        });
        return;
      }
      ws.patchLead(lead.id, patch);
      toast.success(`Applied ${Object.keys(patch).length} research suggestion(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suggest failed");
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Intent quality</CardTitle>
        {canEdit ? (
          <CardAction>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={suggesting}
              onClick={() => void onSuggest()}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {suggesting ? "Suggesting…" : "Suggest signals"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{result.score}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          <Badge variant="outline" className={cn("rounded-md", temp.className)}>
            {temp.label}
          </Badge>
          <Badge variant="secondary" className="rounded-md font-normal">
            {densityLabel(result.density)}
          </Badge>
          {result.meetsThreshold ? (
            <Badge
              variant="outline"
              className="rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
            >
              Ready for outreach
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="rounded-md bg-warning/10 text-warning border-warning/20 gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              Not ready
            </Badge>
          )}
          {result.primaryOpportunity ? (
            <Badge variant="outline" className="rounded-md font-normal">
              {result.primaryOpportunity.label}
            </Badge>
          ) : null}
        </div>
        {result.primaryOpportunity?.triggerLabel ? (
          <p className="text-xs text-muted-foreground">
            Primary angle: <span className="text-foreground">{result.primaryOpportunity.label}</span>
            {" · "}
            Trigger: {result.primaryOpportunity.triggerLabel}
            {result.primaryOpportunity.triggerReason
              ? ` (${result.primaryOpportunity.triggerReason})`
              : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Scored with playbook “{playbook.name}”. Research fields and notes update this automatically.
          </p>
        )}
        {result.qualificationNotes.length ? (
          <ul className="space-y-1 rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
            {result.qualificationNotes.map((note) => (
              <li key={note} className="text-xs text-warning">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
        {result.matchedSignals.length ? (
          <div className="flex flex-wrap gap-1.5">
            {result.matchedSignals.map((s) => (
              <Badge
                key={s.signalId}
                variant="outline"
                className="rounded-md font-normal text-xs"
                title={s.reason}
              >
                {s.label}
                <span className="opacity-60 ml-1">+{s.points}</span>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No intent signals matched yet. Fill research fields or notes with project, pain, or
            partner-search language.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
