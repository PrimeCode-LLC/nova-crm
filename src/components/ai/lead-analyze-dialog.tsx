"use client";

import * as React from "react";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/types";

type Analysis = {
  summary: string;
  wins: string[];
  issues: string[];
  improvements: string[];
  riskLevel: "low" | "medium" | "high";
  nextActions: string[];
};

const RISK_TONE: Record<Analysis["riskLevel"], string> = {
  low: "bg-success/10 text-success border-success/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
};

export function LeadAnalyzeDialog({
  open,
  onOpenChange,
  lead,
  demoContext,
  onAnalysis,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead;
  demoContext?: Record<string, unknown>;
  onAnalysis?: (a: Analysis) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/lead-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          demoContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed");
        return;
      }
      setAnalysis(data as Analysis);
      onAnalysis?.(data as Analysis);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (open && !analysis) void run();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Lead analysis
          </DialogTitle>
          <DialogDescription className="text-xs">
            AI review using lead data, activity, and emails (when available).
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p className="text-xs text-muted-foreground flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {analysis && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Risk</span>
              <Badge variant="outline" className={RISK_TONE[analysis.riskLevel]}>
                {analysis.riskLevel}
              </Badge>
            </div>
            <p className="leading-relaxed">{analysis.summary}</p>
            {analysis.wins.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-success mb-1">Wins</h4>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {analysis.wins.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            {analysis.issues.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-destructive mb-1">Issues</h4>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {analysis.issues.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            {analysis.improvements.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold mb-1">Improvements</h4>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {analysis.improvements.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            {analysis.nextActions.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-primary mb-1">Next actions</h4>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {analysis.nextActions.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void run()}>
          Regenerate
        </Button>
      </DialogContent>
    </Dialog>
  );
}
