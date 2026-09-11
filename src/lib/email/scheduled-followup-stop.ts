import { coerceInstantMs } from "@/lib/db/document-shim/timestamp";

/** True when pausedAt/completedAt is a real marker (not null, missing, or empty string). */
export function hasMeaningfulStopMarker(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return coerceInstantMs(value) != null;
}

/** Stop reason when the scheduled row's followupId has no document (orphan link). */
export const FOLLOWUP_MISSING_STOP_REASON = "Follow-up no longer exists";

/**
 * Reasons the flush must not SMTP-send a followup-linked scheduled email.
 * Empty-string pause/complete markers must not cancel (UI treats them as unset).
 */
export function scheduledFollowupStopReason(input: {
  followupExists: boolean;
  pausedAt?: unknown;
  completedAt?: unknown;
  planStatus?: string;
}): string | undefined {
  if (!input.followupExists) return FOLLOWUP_MISSING_STOP_REASON;
  if (hasMeaningfulStopMarker(input.pausedAt)) return "Follow-up paused";
  if (hasMeaningfulStopMarker(input.completedAt)) return "Follow-up completed";
  const status = String(input.planStatus ?? "").trim();
  if (status === "paused") return "Sequence paused";
  if (status === "superseded") return "Sequence superseded";
  if (status === "completed") return "Sequence completed";
  return undefined;
}
