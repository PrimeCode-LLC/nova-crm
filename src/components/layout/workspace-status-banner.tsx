"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

function errorSummary(e: Error | null | undefined): string {
  if (!e) return "";
  const m = e.message?.trim();
  if (m) return m;
  if (e.name?.trim()) return e.name;
  return "Unknown error";
}

/** Avoid dumping megabytes of vendor error text (or comma-separated lists) into the alert UI. */
function sanitizeBannerDetailText(raw: string, maxLen = 900): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

export function WorkspaceStatusBanner() {
  const router = useRouter();
  const { mode, isDemo, liveFirestoreError, userProfileError } = useWorkspace();
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null);

  const liveErr = mode === "live" && !isDemo ? liveFirestoreError : null;
  const profileErr = mode === "live" && !isDemo ? userProfileError : null;

  const sig = `${errorSummary(liveErr)}|${errorSummary(profileErr)}`;
  const hasIssue = Boolean(liveErr || profileErr);

  React.useEffect(() => {
    if (!hasIssue) setDismissedFor(null);
  }, [hasIssue]);

  if (!hasIssue || dismissedFor === sig) return null;

  const headline =
    liveErr && profileErr
      ? "Workspace connection issue"
      : liveErr
        ? "Couldn’t keep live data in sync"
        : "Couldn’t load your profile";

  const subline =
    liveErr && profileErr
      ? "Live CRM data and your user profile both reported errors. Information on this page may be incomplete until this clears."
      : liveErr
        ? "Lists and counts may be outdated or empty until the connection recovers. Check your network, then try Retry."
        : "Your role and permissions may be wrong until your profile loads. Try Retry or sign out and back in.";

  return (
    <div
      role="alert"
      aria-live="polite"
      className="shrink-0 border-b border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm shadow-[inset_0_1px_0_0_var(--border)]"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">{headline}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{subline}</p>
          <details className="group/details pt-0.5 text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="underline-offset-2 group-open/details:underline">Technical details</span>
            </summary>
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2 rounded-md border border-border/80 bg-background/80 p-2 font-mono text-[11px] leading-snug text-muted-foreground">
              {liveErr ? (
                <p className="break-words whitespace-pre-wrap">
                  <span className="font-sans font-medium text-foreground">Firestore: </span>
                  {sanitizeBannerDetailText(errorSummary(liveErr))}
                </p>
              ) : null}
              {profileErr ? (
                <p className="break-words whitespace-pre-wrap">
                  <span className="font-sans font-medium text-foreground">Profile: </span>
                  {sanitizeBannerDetailText(errorSummary(profileErr))}
                </p>
              ) : null}
            </div>
          </details>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 bg-background/80"
            type="button"
            onClick={() => {
              setDismissedFor(null);
              router.refresh();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            type="button"
            aria-label="Dismiss alert"
            onClick={() => setDismissedFor(sig)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
