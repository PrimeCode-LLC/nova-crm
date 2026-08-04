"use client";

import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

export type BulkFollowupProgress = {
  title: string;
  statusLabel: string;
  done: number;
  total: number;
};

export function BulkFollowupProgressDialog({
  progress,
}: {
  progress: BulkFollowupProgress | null;
}) {
  const open = progress != null && progress.total > 0;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const remaining = Math.max(0, total - done);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const finished = total > 0 && done >= total;

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* Block dismiss while work is running. */
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!finished ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {progress?.title ?? "Working…"}
          </DialogTitle>
          <DialogDescription>
            {finished
              ? "Finishing up…"
              : "Please keep this tab open until the batch completes."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
            <div>
              <div className="text-lg font-semibold tabular-nums">{total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums text-primary">{done}</div>
              <div className="text-xs text-muted-foreground">Done</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">{remaining}</div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>

          <Progress value={pct} className="w-full gap-2">
            <ProgressLabel className="text-xs text-muted-foreground">
              {progress?.statusLabel ?? "Working…"}
            </ProgressLabel>
            <ProgressValue className="text-xs">
              {() => `${done} / ${total} · ${pct}%`}
            </ProgressValue>
          </Progress>
        </div>
      </DialogContent>
    </Dialog>
  );
}
