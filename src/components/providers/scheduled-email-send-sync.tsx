"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useEmailAccountStore } from "@/stores/email-account-store";

/** Demo: quick fallback polling for due sends. */
const DEMO_POLL_MS = 5_000;
/** Live: nudge the worker / member flush without hammering the web tier. */
const LIVE_POLL_MS = 60_000;
/** Ignore visibility/effect re-fires that would stack process-due calls. */
const MIN_RUN_GAP_MS = 45_000;
const PROCESS_DUE_LOCK = "nova-crm-process-due";

/**
 * Sends due scheduled emails while the app is open.
 *
 * - Demo: in-memory `processDueScheduledLocal` (~15s).
 * - Live: POST `/api/email/scheduled/process-due` (enqueue worker when available,
 *   otherwise member-scoped SMTP flush). Complements the every-5-min cron.
 */
export function ScheduledEmailSendSync() {
  const {
    isDemo,
    sessionHydrated,
    currentUserId,
    setFollowupCompleted,
    clearFollowupEmailSchedule,
    syncFollowupDelivery,
  } = useWorkspace();
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const processDueScheduledLocal = useEmailAccountStore((s) => s.processDueScheduledLocal);
  const setScheduled = useEmailAccountStore((s) => s.setScheduled);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const runningRef = React.useRef(false);
  const lastRunAtRef = React.useRef(0);
  const syncedDemoStatusRef = React.useRef(new Map<string, string>());

  const currentUserIdRef = React.useRef(currentUserId);
  const mailViewAsUidRef = React.useRef(mailViewAsUid);
  const setScheduledRef = React.useRef(setScheduled);
  currentUserIdRef.current = currentUserId;
  mailViewAsUidRef.current = mailViewAsUid;
  setScheduledRef.current = setScheduled;

  const runLive = React.useCallback(async () => {
    if (runningRef.current) return;
    if (Date.now() - lastRunAtRef.current < MIN_RUN_GAP_MS) return;

    const execute = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      lastRunAtRef.current = Date.now();
      try {
        const uid = currentUserIdRef.current;
        const viewAs = mailViewAsUidRef.current;
        const qs =
          viewAs && viewAs !== uid ? `?forUser=${encodeURIComponent(viewAs)}` : "";
        const processRes = await fetch(`/api/email/scheduled/process-due${qs}`, {
          method: "POST",
        });
        const processData = (await processRes.json().catch(() => null)) as {
          ok?: boolean;
          busy?: boolean;
          queued?: boolean;
          sent?: number;
          failed?: number;
        } | null;
        if (!processData?.ok || processData.busy) return;

        const sent = processData.sent ?? 0;
        const failed = processData.failed ?? 0;
        if (sent > 0) {
          toast.success(
            sent === 1 ? "Scheduled email sent" : `${sent} scheduled emails sent`,
          );
        }
        if (failed > 0) {
          toast.error(
            failed === 1
              ? "A scheduled email failed to send"
              : `${failed} scheduled emails failed`,
            { description: "Check Inbox → Scheduled for the error details." },
          );
        }
        if (sent > 0 || failed > 0 || processData.queued) {
          const listRes = await fetch(`/api/email/scheduled${qs}`);
          const listData = (await listRes.json().catch(() => null)) as {
            ok?: boolean;
            items?: Parameters<typeof setScheduled>[0];
          } | null;
          if (listData?.ok && Array.isArray(listData.items)) {
            setScheduledRef.current(listData.items);
          }
        }
      } catch {
        /* best-effort */
      } finally {
        runningRef.current = false;
      }
    };

    // Cross-tab lock so multiple open Nova tabs do not stack process-due on one Node process.
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      try {
        await navigator.locks.request(
          PROCESS_DUE_LOCK,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return;
            await execute();
          },
        );
        return;
      } catch {
        /* fall through */
      }
    }
    await execute();
  }, []);

  React.useEffect(() => {
    if (!sessionHydrated || !currentUserId) return;

    if (isDemo) {
      processDueScheduledLocal();
      const id = window.setInterval(() => processDueScheduledLocal(), DEMO_POLL_MS);
      const onVisible = () => {
        if (document.visibilityState === "visible") processDueScheduledLocal();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        window.clearInterval(id);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    if (!emailServerHydrated) return;

    const bootstrapTimer = window.setTimeout(() => void runLive(), 8_000);
    const id = window.setInterval(() => void runLive(), LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void runLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    emailServerHydrated,
    processDueScheduledLocal,
    runLive,
  ]);

  // Demo precision trigger: when the nearest pending row becomes due, flush immediately.
  React.useEffect(() => {
    if (!isDemo) return;
    const pending = scheduled.filter((s) => s.status === "pending");
    if (pending.length === 0) return;

    let minDelayMs = Number.POSITIVE_INFINITY;
    for (const row of pending) {
      const dueMs = new Date(row.scheduledAt).getTime();
      if (Number.isNaN(dueMs)) continue;
      minDelayMs = Math.min(minDelayMs, Math.max(0, dueMs - Date.now()));
    }
    if (!Number.isFinite(minDelayMs)) return;

    const id = window.setTimeout(() => {
      processDueScheduledLocal();
    }, minDelayMs + 50);
    return () => window.clearTimeout(id);
  }, [isDemo, scheduled, processDueScheduledLocal]);

  React.useEffect(() => {
    if (!isDemo) return;
    for (const item of scheduled) {
      if (!item.followupId || item.status === "pending" || item.status === "processing") continue;
      if (syncedDemoStatusRef.current.get(item.id) === item.status) continue;
      syncedDemoStatusRef.current.set(item.id, item.status);
      clearFollowupEmailSchedule(item.followupId);
      if (item.status === "sent") {
        const sentAt = item.sentAt ?? new Date().toISOString();
        syncFollowupDelivery(item.followupId, { deliveryStatus: "sent", sentAt });
        setFollowupCompleted(item.followupId, true);
        toast.success("Scheduled email sent (demo)");
      } else if (item.status === "failed") {
        syncFollowupDelivery(item.followupId, {
          deliveryStatus: "failed",
          failedAt: new Date().toISOString(),
          deliveryError: item.error,
        });
      } else {
        syncFollowupDelivery(item.followupId, {
          deliveryStatus: "cancelled",
          cancelledAt: item.cancelledAt ?? new Date().toISOString(),
          cancelReason: item.cancelReason,
        });
      }
    }
  }, [
    isDemo,
    scheduled,
    clearFollowupEmailSchedule,
    setFollowupCompleted,
    syncFollowupDelivery,
  ]);

  return null;
}
