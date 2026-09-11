"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  getActiveMailbox,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";

/** Demo: quick fallback polling for due sends. */
const DEMO_POLL_MS = 5_000;
/** Live: poll faster while there is due/pending mail so UI status stays current. */
const LIVE_POLL_MS = 20_000;
const LIVE_POLL_IDLE_MS = 60_000;
/** Ignore visibility/effect re-fires that would stack refresh calls. */
const MIN_RUN_GAP_MS = 12_000;
/** setTimeout saturates near 2^31-1; rely on the poll interval for far-future rows. */
const MAX_WAKE_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps scheduled-email list status fresh while the app is open.
 *
 * - Demo: in-memory `processDueScheduledLocal`.
 * - Live: list refresh only (+ soft worker nudge when due). SMTP is owned by the
 *   worker; browser tabs must not run process-due flushes.
 */
export function ScheduledEmailSendSync() {
  const {
    isDemo,
    sessionHydrated,
    currentUserId,
    followups,
    setFollowupCompleted,
    clearFollowupEmailSchedule,
    syncFollowupDelivery,
  } = useWorkspace();
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const processDueScheduledLocal = useEmailAccountStore((s) => s.processDueScheduledLocal);
  const setScheduled = useEmailAccountStore((s) => s.setScheduled);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const runningRef = React.useRef(false);
  const lastRunAtRef = React.useRef(0);
  const syncedDemoStatusRef = React.useRef(new Map<string, string>());

  const currentUserIdRef = React.useRef(currentUserId);
  const mailViewAsUidRef = React.useRef(mailViewAsUid);
  const mailboxesRef = React.useRef(mailboxes);
  const activeMailboxIdRef = React.useRef(activeMailboxId);
  const scheduledRef = React.useRef(scheduled);
  const setScheduledRef = React.useRef(setScheduled);
  const followupsRef = React.useRef(followups);
  currentUserIdRef.current = currentUserId;
  mailViewAsUidRef.current = mailViewAsUid;
  mailboxesRef.current = mailboxes;
  activeMailboxIdRef.current = activeMailboxId;
  scheduledRef.current = scheduled;
  setScheduledRef.current = setScheduled;
  followupsRef.current = followups;

  const countLocalDuePending = React.useCallback(() => {
    const now = Date.now();
    const scheduledDue = scheduledRef.current.filter((s) => {
      if (s.status !== "pending" && s.status !== "processing") return false;
      const due = new Date(s.scheduledAt).getTime();
      return !Number.isNaN(due) && due <= now;
    });
    const followupDue = followupsRef.current.filter((f) => {
      if (f.deliveryStatus !== "scheduled" && !f.scheduledEmailId) return false;
      const when = f.emailScheduledAt;
      if (!when) return false;
      const due = new Date(when).getTime();
      return !Number.isNaN(due) && due <= now;
    });
    return Math.max(scheduledDue.length, followupDue.length);
  }, []);

  const buildScheduledApiPath = React.useCallback((path: string, ownerUid?: string | null) => {
    const uid = currentUserIdRef.current;
    if (ownerUid !== undefined) {
      return appendMailDataOwnerParam(path, ownerUid, uid);
    }
    const forUid = resolveMailApiForUserUid({
      mailViewAsUid: mailViewAsUidRef.current,
      activeMailboxDataOwnerUid: null,
      selfUid: uid,
    });
    return appendMailDataOwnerParam(path, forUid, uid);
  }, []);

  const runLive = React.useCallback(async () => {
    if (runningRef.current) return;
    const duePeek = countLocalDuePending();
    const minGap = duePeek > 0 ? 5_000 : MIN_RUN_GAP_MS;
    if (Date.now() - lastRunAtRef.current < minGap) return;

    runningRef.current = true;
    lastRunAtRef.current = Date.now();
    try {
      // Soft nudge only — route is enqueue-only when the worker queue is on.
      if (duePeek > 0) {
        await fetch("/api/email/scheduled/process-due", { method: "POST" }).catch(() => null);
      }

      const listOwner = resolveMailApiForUserUid({
        mailViewAsUid: mailViewAsUidRef.current,
        activeMailboxDataOwnerUid: getActiveMailbox({
          mailboxes: mailboxesRef.current,
          activeMailboxId: activeMailboxIdRef.current,
        }).dataOwnerUid,
        selfUid: currentUserIdRef.current,
      });
      const listRes = await fetch(buildScheduledApiPath("/api/email/scheduled", listOwner));
      const listData = (await listRes.json().catch(() => null)) as {
        ok?: boolean;
        items?: Parameters<typeof setScheduled>[0];
      } | null;
      if (listData?.ok && Array.isArray(listData.items)) {
        setScheduledRef.current(listData.items);
      }
    } catch {
      /* best-effort */
    } finally {
      runningRef.current = false;
    }
  }, [buildScheduledApiPath, countLocalDuePending]);

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

    const hasDuePending =
      scheduled.some((s) => {
        if (s.status !== "pending" && s.status !== "processing") return false;
        const due = new Date(s.scheduledAt).getTime();
        return !Number.isNaN(due) && due <= Date.now() + 60_000;
      }) ||
      followups.some((f) => {
        if (f.deliveryStatus !== "scheduled" && !f.scheduledEmailId) return false;
        const when = f.emailScheduledAt;
        if (!when) return false;
        const due = new Date(when).getTime();
        return !Number.isNaN(due) && due <= Date.now() + 60_000;
      });
    const pollMs = hasDuePending ? LIVE_POLL_MS : LIVE_POLL_IDLE_MS;

    if (
      scheduled.length === 0 &&
      followups.some((f) => f.deliveryStatus === "scheduled" || f.scheduledEmailId)
    ) {
      void (async () => {
        const listRes = await fetch(buildScheduledApiPath("/api/email/scheduled")).catch(() => null);
        const listData = (await listRes?.json().catch(() => null)) as {
          ok?: boolean;
          items?: Parameters<typeof setScheduled>[0];
        } | null;
        if (listData?.ok && Array.isArray(listData.items) && listData.items.length > 0) {
          setScheduledRef.current(listData.items);
        }
      })();
    }

    const bootstrapTimer = window.setTimeout(() => void runLive(), 3_000);
    const id = window.setInterval(() => void runLive(), pollMs);
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
    scheduled,
    followups,
    buildScheduledApiPath,
  ]);

  React.useEffect(() => {
    const pending = scheduled.filter((s) => s.status === "pending");
    if (pending.length === 0) return;

    let minDelayMs = Number.POSITIVE_INFINITY;
    for (const row of pending) {
      const dueMs = new Date(row.scheduledAt).getTime();
      if (Number.isNaN(dueMs)) continue;
      minDelayMs = Math.min(minDelayMs, Math.max(0, dueMs - Date.now()));
    }
    if (!Number.isFinite(minDelayMs) || minDelayMs > MAX_WAKE_MS) return;

    const id = window.setTimeout(() => {
      if (isDemo) processDueScheduledLocal();
      else void runLive();
    }, minDelayMs + 50);
    return () => window.clearTimeout(id);
  }, [isDemo, scheduled, processDueScheduledLocal, runLive]);

  React.useEffect(() => {
    for (const item of scheduled) {
      if (!item.followupId || item.status === "pending" || item.status === "processing") continue;
      if (syncedDemoStatusRef.current.get(item.id) === item.status) continue;
      syncedDemoStatusRef.current.set(item.id, item.status);
      clearFollowupEmailSchedule(item.followupId);
      if (item.status === "sent") {
        const sentAt = item.sentAt ?? new Date().toISOString();
        syncFollowupDelivery(item.followupId, { deliveryStatus: "sent", sentAt });
        setFollowupCompleted(item.followupId, true);
        if (isDemo) toast.success("Scheduled email sent (demo)");
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
