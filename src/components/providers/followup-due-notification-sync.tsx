"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { createUserNotifications } from "@/lib/notifications/create-user-notification";
import type { CreateUserNotificationInput } from "@/lib/notifications/user-notification-types";

function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Ensures durable follow-up due / overdue notifications once per follow-up per calendar day.
 * Runs client-side when the workspace loads followups for the viewer.
 */
export function FollowupDueNotificationSync() {
  const { followups, currentUserId, organizationId, isDemo, getLeadById } = useWorkspace();
  const ranForDayRef = React.useRef<string>("");

  React.useEffect(() => {
    if (!currentUserId) return;
    const today = dayKey();
    // Re-run when followups change, but keep deterministic ids so writes stay idempotent.
    const start = startOfLocalDay().getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const now = Date.now();

    const mine = followups.filter(
      (f) =>
        f.ownerId === currentUserId &&
        !f.completedAt &&
        !f.pausedAt &&
        !f.cancelledAt,
    );

    const inputs: CreateUserNotificationInput[] = [];
    for (const f of mine) {
      const dueMs = new Date(f.dueAt).getTime();
      if (!Number.isFinite(dueMs)) continue;
      const overdue = dueMs < start;
      const dueToday = dueMs >= start && dueMs < end;
      if (!overdue && !dueToday) continue;

      const lead = f.leadId ? getLeadById(f.leadId) : undefined;
      const leadBit = lead
        ? ` · ${lead.contactName || lead.companyName || "Lead"}`
        : "";
      const href = f.leadId ? `/leads/${f.leadId}?tab=followups` : "/followups";
      const kindLabel = overdue ? "overdue" : "due today";

      inputs.push({
        id: `un-followup-due-${f.id}-${today}`,
        organizationId: organizationId || "demo",
        recipientId: currentUserId,
        // System-style: use self as actor so createUserNotification would skip —
        // use a sentinel actor that differs from recipient for system alerts.
        actorId: "system",
        kind: "followup",
        message: `Follow-up ${kindLabel}: ${f.title}${leadBit}`,
        target: f.title,
        targetHref: href,
        entityType: "followup",
        entityId: f.id,
        createdAt: new Date(now).toISOString(),
      });
    }

    if (!inputs.length) return;
    // Avoid spamming create calls on every followups array identity change within the same day
    // once we've already attempted for this day+count fingerprint.
    const fingerprint = `${today}:${inputs.map((i) => i.id).sort().join(",")}`;
    if (ranForDayRef.current === fingerprint) return;
    ranForDayRef.current = fingerprint;

    void createUserNotifications({ organizationId, isDemo }, inputs);
  }, [followups, currentUserId, organizationId, isDemo, getLeadById]);

  return null;
}
