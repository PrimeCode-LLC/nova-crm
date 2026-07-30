"use client";

import {
  messageFromUnknown,
  stackFromUnknown,
} from "@/lib/error-logging/parse-stack";
import type { ClientReportErrorInput } from "@/lib/error-logging/types";

let lastReportKey = "";
let lastReportAt = 0;
const DEDUPE_MS = 3_000;

/**
 * Fire-and-forget client error report to `/api/org/error-logs`.
 * Never throws; safe to call from catch blocks and toast helpers.
 */
export function reportClientError(input: ClientReportErrorInput): void {
  try {
    if (typeof window === "undefined") return;

    const message = (input.message || messageFromUnknown(input.error)).trim();
    const stack = input.stack ?? stackFromUnknown(input.error);
    const url =
      input.url ??
      (typeof window !== "undefined" ? window.location.href : null);
    const route =
      input.route ??
      (typeof window !== "undefined" ? window.location.pathname : null);

    const dedupeKey = `${message}|${input.location ?? ""}|${input.functionName ?? ""}|${route ?? ""}`;
    const now = Date.now();
    if (dedupeKey === lastReportKey && now - lastReportAt < DEDUPE_MS) {
      return;
    }
    lastReportKey = dedupeKey;
    lastReportAt = now;

    const body = {
      message,
      location: input.location ?? null,
      functionName: input.functionName ?? null,
      stack: stack ?? null,
      url,
      route,
      httpStatus: input.httpStatus ?? null,
    };

    void fetch("/api/org/error-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* never break UI */
    });
  } catch {
    /* never break UI */
  }
}
