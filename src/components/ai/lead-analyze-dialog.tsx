"use client";

import * as React from "react";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Lead } from "@/lib/types";
import type { LeadAiContextInput } from "@/lib/ai/load-lead-ai-context-server";

type Analysis = {
  summary: string;
  wins: string[];
  issues: string[];
  improvements: string[];
  riskLevel: "low" | "medium" | "high";
  nextActions: string[];
  strategyAlignment: "on_track" | "needs_adjustment" | "off_track" | "not_applicable";
  strategyFeedback: string;
  strategySuggestions: string[];
};

const RISK_TONE: Record<Analysis["riskLevel"], string> = {
  low: "bg-success/10 text-success border-success/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
};

const ALIGNMENT_TONE: Record<Exclude<Analysis["strategyAlignment"], "not_applicable">, string> = {
  on_track: "bg-success/10 text-success border-success/20",
  needs_adjustment: "bg-warning/10 text-warning border-warning/20",
  off_track: "bg-destructive/10 text-destructive border-destructive/20",
};

const ALIGNMENT_LABEL: Record<Exclude<Analysis["strategyAlignment"], "not_applicable">, string> = {
  on_track: "On track",
  needs_adjustment: "Needs adjustment",
  off_track: "Off track",
};

export function LeadAnalyzeDialog({
  open,
  onOpenChange,
  lead,
  demoContext,
  emailThreads,
  onAnalysis,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead;
  demoContext?: Record<string, unknown>;
  emailThreads?: LeadAiContextInput["emailThreads"];
  onAnalysis?: (a: Analysis) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [userPrompt, setUserPrompt] = React.useState("");
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);

  React.useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setUserPrompt("");
      setAnalysis(null);
    }
  }, [open]);

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
          emailThreads,
          userPrompt: userPrompt.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Analysis failed");
        return;
      }
      const next = data as Analysis;
      setAnalysis(next);
      onAnalysis?.(next);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const showStrategy =
    analysis &&
    analysis.strategyAlignment !== "not_applicable" &&
    (analysis.strategyFeedback.trim() || analysis.strategySuggestions.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Lead analysis
          </DialogTitle>
          <DialogDescription className="text-xs">
            Reviews CRM data plus the full email thread (sends and replies). Optionally add a
            strategy idea to get direction feedback.
          </DialogDescription>
        </DialogHeader>

        {!analysis && (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="lead-analyze-strategy" className="text-xs">
                Your idea / next step (optional)
              </Label>
              <Textarea
                id="lead-analyze-strategy"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder='e.g. "I think we should pitch workflow automation next" or "Propose a 30-min demo focused on hiring pain"'
                rows={4}
                className="resize-none text-sm"
                maxLength={2_000}
                disabled={loading}
              />
              <p className="text-[10px] text-muted-foreground">
                After analysis, AI will judge whether this direction fits the lead and suggest
                adjustments.
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={loading} onClick={() => void run()}>
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> Analyze lead
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {analysis && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Risk</span>
              <Badge variant="outline" className={RISK_TONE[analysis.riskLevel]}>
                {analysis.riskLevel}
              </Badge>
            </div>
            <p className="leading-relaxed">{analysis.summary}</p>

            {showStrategy && analysis.strategyAlignment !== "not_applicable" && (
              <section className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold">Strategy check</h4>
                  <Badge
                    variant="outline"
                    className={ALIGNMENT_TONE[analysis.strategyAlignment]}
                  >
                    {ALIGNMENT_LABEL[analysis.strategyAlignment]}
                  </Badge>
                </div>
                {analysis.strategyFeedback.trim() ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {analysis.strategyFeedback}
                  </p>
                ) : null}
                {analysis.strategySuggestions.length > 0 && (
                  <ul className="list-disc pl-4 text-xs space-y-0.5">
                    {analysis.strategySuggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

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

            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => {
                  setAnalysis(null);
                  setError(null);
                }}
              >
                Edit idea
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void run()}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
                  </>
                ) : (
                  "Regenerate"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
