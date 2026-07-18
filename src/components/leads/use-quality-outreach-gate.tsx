"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { QualityScoreResult } from "@/lib/intent/types";

type PendingAction = {
  title: string;
  description: string;
  onConfirm: () => void;
};

/**
 * Soft gate for outreach when Quality Score is below the playbook threshold.
 * Call `confirmOrProceed` before compose / campaign push / mailto.
 */
export function useQualityOutreachGate(options: {
  result: QualityScoreResult;
  threshold: number;
  enabled?: boolean;
}) {
  const { result, threshold, enabled = true } = options;
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  const confirmOrProceed = React.useCallback(
    (action: () => void, meta?: { title?: string; description?: string }) => {
      if (!enabled || result.meetsThreshold) {
        action();
        return;
      }
      setPending({
        title: meta?.title ?? "Weak intent score",
        description:
          meta?.description ??
          `Quality score is ${result.score} (threshold ${threshold}). You can still proceed, but this prospect may not be worth outreach yet.`,
        onConfirm: action,
      });
    },
    [enabled, result.meetsThreshold, result.score, threshold],
  );

  const dialog = (
    <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const fn = pending?.onConfirm;
              setPending(null);
              fn?.();
            }}
          >
            Proceed anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmOrProceed, dialog, needsWarning: enabled && !result.meetsThreshold };
}
