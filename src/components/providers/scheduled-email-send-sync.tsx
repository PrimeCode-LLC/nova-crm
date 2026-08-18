"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useEmailAccountStore } from "@/stores/email-account-store";

/** Slower than before — overlapping handlers were starving the local Next.js process. */
const POLL_MS = 180_000;
/** Ignore visibility/effect re-fires that would stack process-due calls. */
const MIN_RUN_GAP_MS = 90_000;
const PROCESS_DUE_LOCK = "nova-crm-process-due";

/**
 * Local/dev-only sender for due scheduled emails.
 *
 * Production is unchanged: Vercel cron (`/api/cron/scheduled-emails/send`) owns live
 * sends, and the Inbox page still owns demo `processDueScheduledLocal`.
 * This component is a no-op when `NODE_ENV === "production"`.
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

  const isLocalDev = process.env.NODE_ENV === "development";

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
        if (sent > 0 || failed > 0) {
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
    // Production: do not poll - cron + existing Inbox demo interval remain the source of truth.
    if (!isLocalDev) return;
    if (!sessionHydrated || !currentUserId) return;

    if (isDemo) {
      processDueScheduledLocal();
      const id = window.setInterval(() => processDueScheduledLocal(), POLL_MS);
      return () => window.clearInterval(id);
    }

    if (!emailServerHydrated) return;

    // Defer first process-due so dashboard / leads can connect —
    // this route often runs tens of seconds and saturates local Next + backend I/O.
    const bootstrapTimer = window.setTimeout(() => void runLive(), 12_000);
    const id = window.setInterval(() => void runLive(), POLL_MS);
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
    isLocalDev,
    isDemo,
    sessionHydrated,
    currentUserId,
    emailServerHydrated,
    processDueScheduledLocal,
    runLive,
  ]);

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
