"use client";

import * as React from "react";
import { reportClientError } from "@/lib/error-logging/report-client";

/**
 * Captures unhandled window errors and promise rejections into admin Error logs.
 */
export function GlobalErrorListener() {
  React.useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const err = event.error instanceof Error ? event.error : undefined;
      reportClientError({
        message: event.message || err?.message || "Unhandled error",
        error: err ?? event.message,
        location: event.filename ? normalizeClientPath(event.filename) : undefined,
        functionName: "window.onerror",
        stack: err?.stack,
        url: typeof window !== "undefined" ? window.location.href : null,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const err = reason instanceof Error ? reason : undefined;
      reportClientError({
        message:
          err?.message ||
          (typeof reason === "string" ? reason : "Unhandled promise rejection"),
        error: reason,
        functionName: "unhandledrejection",
        stack: err?.stack,
        url: typeof window !== "undefined" ? window.location.href : null,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

function normalizeClientPath(filename: string): string | undefined {
  try {
    const path = filename.includes("://") ? new URL(filename).pathname : filename;
    const srcIdx = path.indexOf("src/");
    if (srcIdx >= 0) return path.slice(srcIdx);
    return path || undefined;
  } catch {
    return filename || undefined;
  }
}
