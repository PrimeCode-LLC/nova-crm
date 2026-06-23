"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  featureLabelForPath,
  PAGE_PATH_TO_FEATURE,
} from "@/lib/firestore/audit-events";
import { leadDisplayLabel, leadIdFromPath } from "@/lib/leads/lead-display-label";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

const TRACKED_PREFIXES = Object.keys(PAGE_PATH_TO_FEATURE);

function shouldTrackPath(pathname: string): boolean {
  const base = pathname.split("?")[0] ?? pathname;
  if (base.startsWith("/admin/logs")) return false;
  if (base.startsWith("/auth") || base.startsWith("/onboarding")) return false;
  return TRACKED_PREFIXES.some(
    (prefix) => base === prefix || base.startsWith(`${prefix}/`),
  );
}

/**
 * Records workspace page visits for owners/admins on the Activity logs page.
 * Debounced per path to limit write volume.
 */
export function ActivityAuditTracker() {
  const pathname = usePathname();
  const { getLeadById } = useWorkspace();
  const lastSentRef = React.useRef<{ path: string; at: number } | null>(null);

  React.useEffect(() => {
    if (!pathname || !shouldTrackPath(pathname)) return;

    const base = pathname.split("?")[0] ?? pathname;
    const now = Date.now();
    const last = lastSentRef.current;
    if (last && last.path === base && now - last.at < 60_000) return;

    const leadId = leadIdFromPath(base);
    const lead = leadId ? getLeadById(leadId) : undefined;
    const feature = lead
      ? leadDisplayLabel(lead)
      : featureLabelForPath(base);
    if (!feature) return;

    lastSentRef.current = { path: base, at: now };

    void fetch("/api/org/audit/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "feature.page_view",
        meta: {
          path: base,
          feature,
          label: feature,
          ...(leadId ? { leadId, leadName: feature } : {}),
        },
      }),
    }).catch(() => {
      /* non-blocking */
    });
  }, [pathname, getLeadById]);

  return null;
}
