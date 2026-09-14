"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type EvalRun = {
  id: string;
  status: string;
  itemCount: number;
  passCount: number;
  failCount: number;
  hallucinationCount: number;
  pairwiseWins: number | null;
  pairwiseLosses: number | null;
  finishedAt: string | null;
  summary: unknown;
};

type EvalResult = {
  id: string;
  datasetItemId: string;
  passed: boolean;
  ruleFailures: unknown;
  judgeScores: unknown;
  judgeNotes: string | null;
};

export function EvalRunsTable(props: {
  runs: EvalRun[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<EvalResult[]>([]);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

  async function openRun(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setLoadingId(id);
    try {
      const res = await fetch(`/api/ai/eval-runs?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Failed to load run");
        return;
      }
      setResults(data.results ?? []);
      setExpanded(id);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Eval runs</CardTitle>
            <CardDescription>
              Judge win rates are display-only until calibration &gt;70%.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={props.onRefresh}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {props.runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No eval runs yet.</p>
        )}
        {props.runs.map((run) => {
          const summary = (run.summary ?? {}) as Record<string, unknown>;
          const judgeWin =
            run.pairwiseWins != null &&
            run.pairwiseLosses != null &&
            run.pairwiseWins + run.pairwiseLosses > 0
              ? run.pairwiseWins / (run.pairwiseWins + run.pairwiseLosses)
              : null;
          return (
            <div key={run.id} className="rounded-md border p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{run.status}</Badge>
                  <span className="font-mono">{run.id.slice(0, 16)}…</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingId === run.id}
                  onClick={() => void openRun(run.id)}
                >
                  {expanded === run.id ? "Hide" : "Details"}
                </Button>
              </div>
              <div className="text-muted-foreground">
                {run.passCount}/{run.itemCount} pass · {run.failCount} fail ·{" "}
                {run.hallucinationCount} hallucination · judge win{" "}
                {judgeWin == null ? "—" : `${(100 * judgeWin).toFixed(0)}%`}
                {summary.judgeGating === false ? " (not gating)" : ""}
              </div>
              {expanded === run.id && (
                <ul className="max-h-64 space-y-1 overflow-y-auto border-t pt-2">
                  {results.map((r) => (
                    <li key={r.id} className="rounded bg-muted/40 p-2">
                      <div className="flex justify-between gap-2">
                        <span className="font-mono">{r.datasetItemId}</span>
                        <Badge variant={r.passed ? "secondary" : "destructive"}>
                          {r.passed ? "pass" : "fail"}
                        </Badge>
                      </div>
                      {r.judgeNotes && (
                        <p className="mt-1 text-muted-foreground">{r.judgeNotes}</p>
                      )}
                      <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(r.ruleFailures).slice(0, 300)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
