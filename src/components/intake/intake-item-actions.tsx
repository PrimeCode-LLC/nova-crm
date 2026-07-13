"use client";

import * as React from "react";
import { ExternalLink, Loader2, UserPlus, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { ScraperRawItem } from "@/lib/types";

export function IntakeItemActions({
  item,
  busyAction,
  canDismiss = true,
  onAssignToMe,
  onOpenQueue,
  onDismissConfirmed,
}: {
  item: ScraperRawItem;
  busyAction: "assign" | "queue" | "dismiss" | null;
  canDismiss?: boolean;
  onAssignToMe: () => void | Promise<void>;
  onOpenQueue: () => void | Promise<void>;
  onDismissConfirmed: () => void | Promise<void>;
}) {
  const busy = busyAction !== null;
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const [dismissBusy, setDismissBusy] = React.useState(false);

  async function confirmDismiss() {
    setDismissBusy(true);
    try {
      await onDismissConfirmed();
      setDismissOpen(false);
    } finally {
      setDismissBusy(false);
    }
  }

  return (
    <>
      <AlertDialog open={dismissOpen} onOpenChange={(o) => !dismissBusy && setDismissOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this post?</AlertDialogTitle>
            <AlertDialogDescription>
              It will leave the intake pool and won&apos;t be promoted. You can still find new posts
              when feeds run again. This does not delete anything already promoted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={dismissBusy}
              onClick={() => void confirmDismiss()}
            >
              {dismissBusy ? "Dismissing…" : "Dismiss"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-2">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            className="w-fit shrink-0"
            nativeButton={false}
            title="Open the original post in a new tab"
            render={
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> View source
              </a>
            }
          />

          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Intake actions"
          >
            {canDismiss ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={busy}
                title="Remove from the pool without creating a prospect"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDismissOpen(true)}
              >
                <X className="h-3.5 w-3.5" /> Dismiss
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={busy}
              title="Create a prospect anyone on the team can claim (Prospects → Open queue)"
              onClick={() => void onOpenQueue()}
            >
              {busyAction === "queue" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Users className="h-3.5 w-3.5" />
              )}
              Open queue
            </Button>

            <Button
              variant="default"
              size="sm"
              type="button"
              disabled={busy}
              title="Create a prospect and assign yourself as owner"
              onClick={() => void onAssignToMe()}
            >
              {busyAction === "assign" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              Assign to me
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {canDismiss
            ? "Review the source, then assign to yourself or the team queue. Dismiss only if the post is not a fit."
            : "Review the source, then assign to yourself or the team queue."}
        </p>
      </div>
    </>
  );
}
