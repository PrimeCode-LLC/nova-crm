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
/** Live: poll faster while there is due/pending mail so prod does not wait a full minute. */
const LIVE_POLL_MS = 20_000;
const LIVE_POLL_IDLE_MS = 60_000;
/** Ignore visibility/effect re-fires that would stack process-due calls. */
const MIN_RUN_GAP_MS = 12_000;
/** Avoid toast spam while a due row is legitimately processing / queued. */
const STALLED_TOAST_GAP_MS = 45_000;
/** setTimeout saturates near 2^31-1; rely on the poll interval for far-future rows. */
const MAX_WAKE_MS = 24 * 60 * 60 * 1000;
const PROCESS_DUE_LOCK = "nova-crm-process-due";

/**
 * Sends due scheduled emails while the app is open.
 *
 * - Demo: in-memory `processDueScheduledLocal`.
 * - Live: POST `/api/email/scheduled/process-due` for the active mailbox owner
 *   (assigned/shared boxes store rows under the owner uid, not the viewer).
 *   Also enqueues the worker tick. Complements the every-5-min cron.
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
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const runningRef = React.useRef(false);
  const lastRunAtRef = React.useRef(0);
  const lastStalledToastAtRef = React.useRef(0);
  const syncedDemoStatusRef = React.useRef(new Map<string, string>());

  const currentUserIdRef = React.useRef(currentUserId);
  const mailViewAsUidRef = React.useRef(mailViewAsUid);
  const mailboxesRef = React.useRef(mailboxes);
  const activeMailboxIdRef = React.useRef(activeMailboxId);
  const scheduledRef = React.useRef(scheduled);
  const setScheduledRef = React.useRef(setScheduled);
  currentUserIdRef.current = currentUserId;
  mailViewAsUidRef.current = mailViewAsUid;
  mailboxesRef.current = mailboxes;
  activeMailboxIdRef.current = activeMailboxId;
  scheduledRef.current = scheduled;
  setScheduledRef.current = setScheduled;

  /** Owners whose scheduledEmails collections we must flush (viewer + assigned box hosts). */
  const resolveFlushOwnerUids = React.useCallback((): string[] => {
    const selfUid = currentUserIdRef.current;
    const owners = new Set<string>();
    owners.add(selfUid);

    const viewAs = (mailViewAsUidRef.current ?? "").trim();
    if (viewAs && viewAs !== selfUid) owners.add(viewAs);

    const boxes = mailboxesRef.current;
    const activeId = activeMailboxIdRef.current;
    const active = getActiveMailbox({ mailboxes: boxes, activeMailboxId: activeId });
    const activeOwner = active.dataOwnerUid?.trim();
    if (activeOwner) owners.add(activeOwner);

    for (const row of scheduledRef.current) {
      if (row.status !== "pending" && row.status !== "processing") continue;
      const rowOwner = row.uid?.trim();
      if (rowOwner) owners.add(rowOwner);
      const box = boxes.find((m) => m.id === row.mailboxId);
      const owner = box?.dataOwnerUid?.trim();
      if (owner) owners.add(owner);
    }

    return [...owners];
  }, []);

  const countLocalDuePending = React.useCallback(() => {
    const now = Date.now();
    return scheduledRef.current.filter((s) => {
      if (s.status !== "pending" && s.status !== "processing") return false;
      const due = new Date(s.scheduledAt).getTime();
      return !Number.isNaN(due) && due <= now;
    }).length;
  }, []);

  const buildScheduledApiPath = React.useCallback((path: string, ownerUid?: string | null) => {
    const uid = currentUserIdRef.current;
    // Prefer an explicit owner. Do not route through resolveMailApiForUserUid here —
    // that helper prefers view-as and would collapse every owner onto one uid.
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
    if (Date.now() - lastRunAtRef.current < MIN_RUN_GAP_MS) return;

    const execute = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      lastRunAtRef.current = Date.now();
      try {
        const owners = resolveFlushOwnerUids();
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        let queued = false;
        let busy = false;
        let dueFound = 0;
        let pendingCount = 0;
        let sawCounts = false;
        let anyOk = false;
        const skipReasons: Record<string, number> = {};
        const localDue = countLocalDuePending();

        for (const owner of owners) {
          const processPath = buildScheduledApiPath(
            "/api/email/scheduled/process-due",
            owner,
          );
          const processRes = await fetch(processPath, { method: "POST" });
          const processData = (await processRes.json().catch(() => null)) as {
            ok?: boolean;
            busy?: boolean;
            queued?: boolean;
            sent?: number;
            failed?: number;
            skipped?: number;
            dueFound?: number;
            pendingCount?: number;
            skipReasons?: Record<string, number>;
            rows?: Array<{
              id: string;
              outcome: string;
              reason?: string;
              blockedByFollowupId?: string;
              detail?: string;
            }>;
            error?: string;
            hint?: string;
          } | null;
          if (!processRes.ok) {
            if (processRes.status === 404) {
              toast.error("Scheduled send is not available on this deploy", {
                description: "Redeploy web with the latest scheduled-email fix.",
              });
              return;
            }
            continue;
          }
          if (!processData?.ok) continue;
          anyOk = true;
          sent += processData.sent ?? 0;
          failed += processData.failed ?? 0;
          skipped += processData.skipped ?? 0;
          if (typeof processData.dueFound === "number") {
            dueFound += processData.dueFound;
            sawCounts = true;
          }
          if (typeof processData.pendingCount === "number") {
            pendingCount += processData.pendingCount;
            sawCounts = true;
          }
          if (processData.skipReasons) {
            for (const [key, count] of Object.entries(processData.skipReasons)) {
              if (typeof count === "number" && count > 0) {
                skipReasons[key] = (skipReasons[key] ?? 0) + count;
              }
            }
          }
          if (processData.queued) queued = true;
          if (processData.busy) busy = true;
        }

        if (!anyOk) return;

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
        } else if (
          sent === 0 &&
          !busy &&
          (localDue > 0 || dueFound > 0) &&
          Date.now() - lastStalledToastAtRef.current >= STALLED_TOAST_GAP_MS
        ) {
          lastStalledToastAtRef.current = Date.now();
          const topSkip = Object.entries(skipReasons).sort((a, b) => b[1] - a[1])[0];
          const skipLabel = topSkip?.[0];
          const skipDesc =
            skipLabel === "wait_for_prior"
              ? "Waiting on an earlier sequence step — check that step’s send status."
              : skipLabel === "send_gap"
                ? "Deferred by mailbox send gap — will retry shortly."
                : skipLabel === "quota"
                  ? "Daily send quota reached — retries tomorrow."
                  : skipLabel === "exception"
                    ? "Send hit an error and will retry — check Inbox → Scheduled."
                    : skipLabel === "claim_refused"
                      ? "Another flush is already processing this mail."
                      : null;
          toast.message("Due email still not sent", {
            description:
              skipDesc ??
              (sawCounts && pendingCount === 0 && localDue > 0
                ? "Followup is marked Scheduled but no pending row was found for this mailbox owner."
                : queued && skipped === 0
                  ? "Queued for the worker. If it stays pending, check worker/cron on the server."
                  : `Found ${Math.max(localDue, dueFound)} due — open Inbox → Scheduled for status/error.`),
          });
        }

        // Always refresh when we attempted a flush and local/server thinks mail is due.
        if (sent > 0 || failed > 0 || queued || busy || localDue > 0 || dueFound > 0) {
          const listOwner = resolveMailApiForUserUid({
            mailViewAsUid: mailViewAsUidRef.current,
            activeMailboxDataOwnerUid: getActiveMailbox({
              mailboxes: mailboxesRef.current,
              activeMailboxId: activeMailboxIdRef.current,
            }).dataOwnerUid,
            selfUid: currentUserIdRef.current,
          });
          const listRes = await fetch(
            buildScheduledApiPath("/api/email/scheduled", listOwner),
          );
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
  }, [buildScheduledApiPath, resolveFlushOwnerUids, countLocalDuePending]);

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

    const hasDuePending = scheduled.some((s) => {
      if (s.status !== "pending" && s.status !== "processing") return false;
      const due = new Date(s.scheduledAt).getTime();
      return !Number.isNaN(due) && due <= Date.now() + 60_000;
    });
    const pollMs = hasDuePending ? LIVE_POLL_MS : LIVE_POLL_IDLE_MS;

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
  ]);

  // Flush exactly when the nearest pending row becomes due (demo + live).
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

  // Mirror server delivery onto followups when the scheduled list updates (demo + live).
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
