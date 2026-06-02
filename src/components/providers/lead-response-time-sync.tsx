"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import {
  computeLeadFirstOutboundResponseMinutes,
  isLeadOrProspect,
} from "@/lib/email/lead-response-time";

/**
 * Persists email-derived first-outbound response times onto lead rows so
 * server-side features (AI brief) stay aligned with the dashboard KPI.
 */
export function LeadResponseTimeSync() {
  const { leads, patchLead } = useWorkspace();
  const emailCtx = useLeadEmailResponseContext();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      for (const lead of leads) {
        if (!isLeadOrProspect(lead)) continue;
        const computed = computeLeadFirstOutboundResponseMinutes(lead, emailCtx);
        if (computed == null) continue;
        if (lead.responseTimeMinutes === computed) continue;
        patchLead(lead.id, { responseTimeMinutes: computed });
      }
    }, 1200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [leads, emailCtx, patchLead]);

  return null;
}
