"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PIPELINE_STAGES, STAGES_BY_KEY } from "@/lib/constants";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber } from "@/lib/format";
import type { Lead, PipelineStage } from "@/lib/types";

type PipelineDistributionProps = {
  leads?: Lead[];
  /** Precomputed sales-lead counts by stage (P0.9); skips client aggregation when set. */
  stageCounts?: Record<string, number> | null;
};

export function PipelineDistribution({
  leads: leadsOverride,
  stageCounts: stageCountsOverride,
}: PipelineDistributionProps = {}) {
  const ws = useWorkspace();
  const leads = leadsOverride ?? ws.leads;
  const countsFromLeads = leads.reduce<Record<PipelineStage, number>>(
    (acc, l) => {
      acc[l.stage] = (acc[l.stage] ?? 0) + 1;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );
  const counts = stageCountsOverride ?? countsFromLeads;
  const total = stageCountsOverride
    ? Object.values(stageCountsOverride).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : leads.length;
  const stagesToShow = PIPELINE_STAGES.filter((s) => s.key !== "won" && s.key !== "lost");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Pipeline distribution</CardTitle>
        <CardDescription className="text-xs">
          {fmtNumber(total)} leads across channels you can access
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex h-7 w-full overflow-hidden rounded-md border">
          {stagesToShow.map((s) => {
            const v = counts[s.key] ?? 0;
            const pct = total > 0 ? (v / total) * 100 : 0;
            if (pct < 0.5) return null;
            return (
              <div
                key={s.key}
                title={`${STAGES_BY_KEY[s.key].label}: ${v}`}
                className="relative h-full transition-all hover:brightness-110"
                style={{
                  width: `${pct}%`,
                  background: `var(--chart-${((PIPELINE_STAGES.findIndex((x) => x.key === s.key) % 5) + 1)})`,
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
          {stagesToShow.map((s, i) => {
            const v = counts[s.key] ?? 0;
            return (
              <div key={s.key} className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{
                    background: `var(--chart-${(i % 5) + 1})`,
                  }}
                />
                <span className="truncate text-muted-foreground">{s.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{v}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
