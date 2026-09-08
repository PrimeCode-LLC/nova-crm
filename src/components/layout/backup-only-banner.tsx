"use client";

import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

/**
 * Non-dismissible spend-pause banner while platform Backup only mode is on.
 */
export function BackupOnlyBanner() {
  const { backupOnlyMode, isDemo } = useWorkspace();

  if (!backupOnlyMode || isDemo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm"
    >
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium text-foreground">Backup only — automation paused</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Live Firestore listeners, scrapers, IMAP sync, and scheduled email sends are off to cut
            Firebase spend. Data stays available for occasional lookups.{" "}
            <Link href="/platform/settings" className="underline underline-offset-2 hover:text-foreground">
              Platform settings
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
