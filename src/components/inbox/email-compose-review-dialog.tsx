"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

type EmailComposeReview = {
  summary: string;
  verdict: string;
  overallScore: number;
  dimensions: {
    personalization: number;
    threadFit: number;
    clarity: number;
    cta: number;
    tone: number;
  };
  wins: string[];
  issues: string[];
  improvements: string[];
  improvedBody: string;
};

type EmailComposeReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: () => Promise<EmailComposeReview | null>;
  onApplyImproved: (improvedBody: string) => void;
};

const SCORE_TONE = {
  strong: "border-success/20 bg-success/10 text-success",
  okay: "border-warning/20 bg-warning/10 text-warning",
  weak: "border-destructive/20 bg-destructive/10 text-destructive",
} as const;

const DIMENSION_LABELS: Array<{
  key: keyof EmailComposeReview["dimensions"];
  label: string;
}> = [
  { key: "personalization", label: "Personalization" },
  { key: "threadFit", label: "Thread fit" },
  { key: "clarity", label: "Clarity" },
  { key: "cta", label: "CTA" },
  { key: "tone", label: "Tone" },
];

function scoreTone(score: number) {
  if (score >= 80) return SCORE_TONE.strong;
  if (score >= 60) return SCORE_TONE.okay;
  return SCORE_TONE.weak;
}

export function EmailComposeReviewDialog({
  open,
  onOpenChange,
  onRun,
  onApplyImproved,
}: EmailComposeReviewDialogProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [review, setReview] = React.useState<EmailComposeReview | null>(null);

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await onRun();
      if (next) setReview(next);
    } catch {
      setError("Could not review this draft right now.");
    } finally {
      setLoading(false);
    }
  }, [onRun]);

  React.useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setReview(null);
      return;
    }
    void run();
  }, [open, run]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Review email draft
          </DialogTitle>
          <DialogDescription className="text-xs">
            Scores your draft against the lead context and full thread, then suggests sharper copy.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Reviewing your draft...
          </div>
        ) : review ? (
          <div className="space-y-4 text-sm">
            <section className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Send readiness
                  </p>
                  <p className="text-2xl font-semibold">{review.overallScore}%</p>
                </div>
                <Badge variant="outline" className={scoreTone(review.overallScore)}>
                  {review.verdict}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{review.summary}</p>
            </section>

            <section className="space-y-2 rounded-lg border p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Score breakdown
              </h4>
              <div className="space-y-3">
                {DIMENSION_LABELS.map(({ key, label }) => (
                  <Progress key={key} value={review.dimensions[key]} className="gap-1.5">
                    <ProgressLabel className="text-xs">{label}</ProgressLabel>
                    <ProgressValue className="text-xs">{review.dimensions[key]}%</ProgressValue>
                  </Progress>
                ))}
              </div>
            </section>

            {review.wins.length > 0 ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold text-success">What works</h4>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {review.wins.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {review.issues.length > 0 ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold text-destructive">What to fix</h4>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {review.issues.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {review.improvements.length > 0 ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold text-primary">Suggested improvements</h4>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {review.improvements.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Improved draft
                </h4>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    onApplyImproved(review.improvedBody);
                    onOpenChange(false);
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Apply improved draft
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs leading-relaxed">
                {review.improvedBody}
              </pre>
            </section>
          </div>
        ) : (
          <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
            <p>{error ?? "No review available yet."}</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void run()}>
            Review again
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
