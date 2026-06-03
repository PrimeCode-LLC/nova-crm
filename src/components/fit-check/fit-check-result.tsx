"use client";

import * as React from "react";
import { Check, Copy, X, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { OpportunityFitResult } from "@/lib/ai/opportunity-fit-types";
import { FIT_GAP_KIND_LABELS, verdictMeta } from "@/lib/ai/opportunity-fit-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function FitCheckResultView({
  result,
  onDiscuss,
  onCreateProspect,
}: {
  result: OpportunityFitResult;
  onDiscuss: () => void;
  onCreateProspect?: () => void;
}) {
  const vm = verdictMeta(result.verdict);
  const [copiedHook, setCopiedHook] = React.useState<number | null>(null);

  async function copyText(text: string, hookIdx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHook(hookIdx);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopiedHook(null), 2000);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-lg border px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3",
          vm.className,
        )}
      >
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold">{vm.label}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {result.fitScore}%
            </Badge>
            <span className="text-sm opacity-90">{result.fitLabel}</span>
          </div>
          <p className="text-sm mt-2 max-w-2xl">{result.summary}</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
          <span className="text-xs uppercase tracking-wide opacity-80">Fit score</span>
          <span className="text-3xl font-semibold tabular-nums">{result.fitScore}</span>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Should you pursue?</CardTitle>
          <CardDescription className="text-xs">
            Effort: {result.pursueRecommendation.estimatedEffort}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p className="font-medium">{result.pursueRecommendation.headline}</p>
          <p className="text-muted-foreground">{result.pursueRecommendation.reasoning}</p>
        </CardContent>
      </Card>

      {result.dimensions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Fit breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.dimensions.map((d) => (
              <div key={d.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{d.label}</span>
                  <span className="tabular-nums text-muted-foreground">{d.score}%</span>
                </div>
                <Progress value={d.score} className="h-1.5" />
                {d.note ? <p className="text-xs text-muted-foreground">{d.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-600" /> Strong matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2 list-none p-0 m-0">
              {result.strongMatches.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-600 shrink-0">•</span>
                  <span>
                    {m.point}
                    {m.sourceTitle.trim() ? (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        — {m.sourceTitle.trim()}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Gaps in the opportunity
            </CardTitle>
            <CardDescription className="text-xs">
              Mismatches vs your knowledge base — not missing items from your company profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2 list-none p-0 m-0">
              {result.gaps.map((g, i) => (
                <li key={i} className="flex gap-2">
                  {g.severity === "blocker" ? (
                    <X className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  ) : (
                    <span className="text-muted-foreground shrink-0">•</span>
                  )}
                  <span>
                    {g.point}
                    <span className="flex flex-wrap gap-1 mt-1">
                      {g.gapKind ? (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 font-normal">
                          {FIT_GAP_KIND_LABELS[g.gapKind] ?? g.gapKind}
                        </Badge>
                      ) : null}
                      {g.severity === "blocker" ? (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">
                          Blocker
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Outreach hooks</CardTitle>
          <CardDescription className="text-xs">Two angles you can try — copy and personalize.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.hooks.map((h, i) => (
            <div key={i} className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex justify-between gap-2">
                <p className="text-sm font-medium">{h.angle}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => void copyText(h.opener, i)}
                >
                  {copiedHook === i ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Pain: {h.painPoint}</p>
              <p className="text-sm whitespace-pre-wrap">{h.opener}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {result.ragCitations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Knowledge used</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.ragCitations.map((c, i) => (
              <div key={i} className="text-xs border rounded-md p-2">
                <p className="font-medium">{c.title}</p>
                <p className="text-muted-foreground mt-1 line-clamp-3">{c.excerpt}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onDiscuss}>
          Discuss with AI
        </Button>
        {onCreateProspect ? (
          <Button type="button" variant="outline" onClick={onCreateProspect}>
            Add as prospect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
