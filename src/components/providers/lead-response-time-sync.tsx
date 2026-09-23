"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import {
  computeLeadFirstOutboundResponseMinutes,
  isLeadOrProspect,
} from "@/lib/email/lead-response-time";

/** Avoid write storms when many leads need a response-time backfill in one tick. */
const MAX_PATCHES_PER_TICK = 8;

/**
 * Persists email-derived first-outbound response times onto lead rows so
 * server-side features (AI brief) stay aligned with the dashboard KPI.
 * Capped per tick to avoid hanging the UI with dozens of concurrent patches.
 */
export function LeadResponseTimeSync() {
  const { leads, patchLead, isDemo } = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(isDemo);
  const emailCtx = useLeadEmailResponseContext();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (snapshotOff) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      let patched = 0;
      for (const lead of leads) {
        if (patched >= MAX_PATCHES_PER_TICK) break;
        if (!isLeadOrProspect(lead)) continue;
        const computed = computeLeadFirstOutboundResponseMinutes(lead, emailCtx);
        if (computed == null) continue;
        if (lead.responseTimeMinutes === computed) continue;
        patchLead(lead.id, { responseTimeMinutes: computed });
        patched += 1;
      }
    }, 1200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [leads, emailCtx, patchLead, snapshotOff]);

  return null;
}
