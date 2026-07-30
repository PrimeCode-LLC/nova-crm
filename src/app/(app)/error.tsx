"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/error-logging/report-client";

/** Runtime crash boundary for the (app) shell. Shows the real error in production so we can diagnose React #185 / hook errors that minified bundles otherwise hide behind a generic "this page couldn't load" screen. */
export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[app-error-boundary]", {
        name: error.name,
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      });
      reportClientError({
        message: error.message || "Something broke on this page",
        error,
        location: "src/app/(app)/error.tsx",
        functionName: "AppRouteError",
        stack: error.stack,
        url: window.location.href,
        route: window.location.pathname,
      });
    }
  }, [error]);

  const stack = error.stack ?? "";
  const message = error.message || "Unknown error";

  return (
    <div className="flex h-svh w-full items-start justify-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          <h1 className="text-base font-semibold">Something broke on this page</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          The page hit a runtime error. Details below help us pinpoint the cause.
        </p>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
          <div>
            <span className="font-sans font-medium text-foreground">Message: </span>
            <span className="break-words">{message}</span>
          </div>
          {error.digest ? (
            <div>
              <span className="font-sans font-medium text-foreground">Digest: </span>
              <span className="break-all">{error.digest}</span>
            </div>
          ) : null}
          {stack ? (
            <div>
              <span className="font-sans font-medium text-foreground">Stack:</span>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10.5px]">
                {stack}
              </pre>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (typeof window !== "undefined") window.location.href = "/dashboard";
            }}
          >
            Reload dashboard
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (typeof window === "undefined") return;
              const text = `Message: ${message}\nDigest: ${error.digest ?? ""}\n\n${stack}`;
              void navigator.clipboard?.writeText(text).catch(() => {});
            }}
          >
            Copy details
          </Button>
        </div>
      </div>
    </div>
  );
}
