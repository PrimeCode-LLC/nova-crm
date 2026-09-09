import { coerceInstantMs } from "@/lib/db/document-shim/timestamp";

/** Due when scheduledAt elapsed and optional notBeforeAt (send-gap deferral) has elapsed. */
export function isScheduledDocDue(data: Record<string, unknown>, nowMs: number): boolean {
  const dueMs = coerceInstantMs(data.scheduledAt);
  if (dueMs == null || dueMs > nowMs) return false;
  const notBeforeMs = coerceInstantMs(data.notBeforeAt);
  if (notBeforeMs != null && notBeforeMs > nowMs) return false;
  return true;
}
