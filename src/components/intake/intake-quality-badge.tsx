"use client";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { densityLabel } from "@/lib/intent/compute-quality-score";
import type { IntentPlaybook, QualityScoreResult } from "@/lib/intent/types";
import { cn } from "@/lib/utils";

function toneForScore(score: number, threshold: number): string {
  if (score <= 0) return "bg-muted text-muted-foreground border-border";
  if (score < threshold) return "bg-info/10 text-info border-info/20";
  if (score < 70) return "bg-warning/10 text-warning border-warning/20";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
}

export function IntakeQualityBadge({
  result,
  playbook,
  className,
}: {
  result: QualityScoreResult;
  playbook: IntentPlaybook;
  className?: string;
}) {
  const topSignals = result.matchedSignals
    .filter((s) => s.category !== "engagement")
    .slice(0, 2);

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md tabular-nums gap-1.5 font-medium",
        toneForScore(result.score, playbook.outreachThreshold),
        className,
      )}
    >
      <span>{result.score || "—"}</span>
      {result.signalCount > 0 ? (
        <span className="opacity-70 text-[10px] font-normal">{result.signalCount}sig</span>
      ) : null}
      {result.meetsThreshold ? (
        <span className="opacity-80 text-[10px] font-normal">Ready</span>
      ) : null}
    </Badge>
  );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex cursor-default"
            aria-label="Intake quality score details"
          />
        }
      >
        {badge}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Match {result.score}/100</p>
          <p className="text-xs text-muted-foreground">{densityLabel(result.density)}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {result.meetsThreshold
            ? `Looks like a playbook fit (≥ ${playbook.outreachThreshold})`
            : result.signalCount > 0
              ? `Some signals — below threshold (${playbook.outreachThreshold})`
              : "No playbook signals in this post yet"}
        </p>
        {result.primaryOpportunity ? (
          <p className="text-xs">
            <span className="font-medium">{result.primaryOpportunity.label}</span>
            {result.primaryOpportunity.triggerLabel
              ? ` · ${result.primaryOpportunity.triggerLabel}`
              : ""}
          </p>
        ) : null}
        {topSignals.length ? (
          <ul className="space-y-1.5 border-t pt-2">
            {result.matchedSignals
              .filter((s) => s.category !== "engagement")
              .slice(0, 6)
              .map((s) => (
                <li key={s.signalId} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="font-medium">{s.label}</span>
                    <span className="block text-muted-foreground truncate">{s.reason}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground shrink-0">+{s.points}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground border-t pt-2">
            Scored with “{playbook.name}”. Promote still works — quality improves once research is
            filled.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
