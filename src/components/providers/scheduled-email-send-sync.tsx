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
 * - Live: path-scoped member `process-due?forUser=` first when mail is due (fast),
 *   then org-wide sweep as secondary. Org collectionGroup must not block due sends.
 *   Also enqueues the worker tick. Complements the every-5-min cron.
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
  const lastStalledToastAtRef = React.useRef(0);
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

  /** Owners whose scheduledEmails collections we must flush (viewer + assigned box hosts + followup owners). */
  const resolveFlushOwnerUids = React.useCallback((): string[] => {
    const selfUid = currentUserIdRef.current;
    const owners = new Set<string>();
    if (selfUid) owners.add(selfUid);

    const viewAs = (mailViewAsUidRef.current ?? "").trim();
    if (viewAs && viewAs !== selfUid) owners.add(viewAs);

    const boxes = mailboxesRef.current;
    // Add all accessible mailbox dataOwnerUids
    for (const box of boxes) {
      const boxOwner = box.dataOwnerUid?.trim();
      if (boxOwner) owners.add(boxOwner);
    }

    // Add owners from followups in workspace
    for (const f of followupsRef.current) {
      if (f.deliveryStatus === "scheduled" || f.scheduledEmailId) {
        if (f.mailboxOwnerUid?.trim()) owners.add(f.mailboxOwnerUid.trim());
        if (f.ownerId?.trim()) owners.add(f.ownerId.trim());
      }
    }

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
    // Only email schedule times — followup.dueAt is the CRM task date, not send readiness.
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

    if (scheduledDue.length > 0 || followupDue.length > 0) {
      console.log("[scheduled-sync] local due candidates", {
        scheduled: scheduledDue.slice(0, 5).map((s) => ({
          id: s.id,
          scheduledAt: s.scheduledAt,
          status: s.status,
          mailboxId: s.mailboxId,
        })),
        followups: followupDue.slice(0, 5).map((f) => ({
          id: f.id,
          emailScheduledAt: f.emailScheduledAt,
          scheduledEmailId: f.scheduledEmailId,
        })),
      });
    }

    return Math.max(scheduledDue.length, followupDue.length);
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
    // Allow faster retries when the client already sees due mail (prod busy lock races).
    const duePeek = countLocalDuePending();
    const minGap = duePeek > 0 ? 5_000 : MIN_RUN_GAP_MS;
    if (Date.now() - lastRunAtRef.current < minGap) return;

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
        let orgBusy = false;
        let memberBusy = false;
        let dueFound = 0;
        let pendingCount = 0;
        let sawCounts = false;
        let anyOk = false;
        const skipReasons: Record<string, number> = {};
        const localDue = duePeek > 0 ? duePeek : countLocalDuePending();

        console.log(`[scheduled-sync] runLive started: localDue=${localDue}, owners=${JSON.stringify(owners)}, followupsInWorkspace=${followupsRef.current.length}`);

        type ProcessDueResponse = {
          ok?: boolean;
          busy?: boolean;
          queued?: boolean;
          sent?: number;
          failed?: number;
          skipped?: number;
          dueFound?: number;
          pendingCount?: number;
          notBeforeBlocked?: number;
          diagnostics?: {
            nowIso?: string;
            earliestPendingScheduledAt?: string | null;
            notBeforeBlocked?: number;
            unparsedScheduledAt?: number;
            overdueIgnoringNotBefore?: number;
            sample?: unknown[];
          };
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
        };

        const processOne = async (processPath: string) => {
          console.log(`[scheduled-sync] Calling process-due endpoint: "${processPath}"`);
          const processRes = await fetch(processPath, { method: "POST" });
          const processData = (await processRes.json().catch(() => null)) as ProcessDueResponse | null;

          console.log(`[scheduled-sync] Response from "${processPath}": status=${processRes.status}`, processData);

          if (!processRes.ok) {
            if (processRes.status === 404) {
              toast.error("Scheduled send is not available on this deploy", {
                description: "Redeploy web with the latest scheduled-email fix.",
              });
              return { fatal404: true as const, data: null };
            }
            return { fatal404: false as const, data: processData };
          }
          if (!processData?.ok) return { fatal404: false as const, data: processData };

          anyOk = true;
          sent += processData.sent ?? 0;
          failed += processData.failed ?? 0;
          skipped += processData.skipped ?? 0;
          if (typeof processData.dueFound === "number") {
            dueFound += processData.dueFound;
            sawCounts = true;
          }
          if (typeof processData.pendingCount === "number") {
            pendingCount = Math.max(pendingCount, processData.pendingCount);
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

          if (Array.isArray(processData.rows)) {
            for (const r of processData.rows) {
              if (r.outcome !== "sent") continue;
              const targetFollowup = followupsRef.current.find((f) => f.scheduledEmailId === r.id);
              if (!targetFollowup) continue;
              console.log(`[scheduled-sync] Immediately updating UI status to sent for followup "${targetFollowup.id}" (scheduledId: "${r.id}")`);
              syncFollowupDelivery(targetFollowup.id, {
                deliveryStatus: "sent",
                sentAt: new Date().toISOString(),
              });
              setFollowupCompleted(targetFollowup.id, true);
              clearFollowupEmailSchedule(targetFollowup.id);
            }
          }
          return { fatal404: false as const, data: processData };
        };

        /** Owners that hold a locally due row — flush these before everyone else. */
        const dueOwnerUids = (() => {
          const now = Date.now();
          const set = new Set<string>();
          const boxes = mailboxesRef.current;
          for (const s of scheduledRef.current) {
            if (s.status !== "pending" && s.status !== "processing") continue;
            const due = new Date(s.scheduledAt).getTime();
            if (Number.isNaN(due) || due > now) continue;
            if (s.uid?.trim()) set.add(s.uid.trim());
            const box = boxes.find((m) => m.id === s.mailboxId);
            const owner = box?.dataOwnerUid?.trim();
            if (owner) set.add(owner);
          }
          for (const f of followupsRef.current) {
            if (f.deliveryStatus !== "scheduled" && !f.scheduledEmailId) continue;
            if (!f.emailScheduledAt) continue;
            const due = new Date(f.emailScheduledAt).getTime();
            if (Number.isNaN(due) || due > now) continue;
            if (f.mailboxOwnerUid?.trim()) set.add(f.mailboxOwnerUid.trim());
            if (f.ownerId?.trim()) set.add(f.ownerId.trim());
          }
          return [...set];
        })();

        const orderedOwners = [
          ...dueOwnerUids,
          ...owners.filter((o) => !dueOwnerUids.includes(o)),
        ];

        const memberPaths: string[] = [];
        for (const owner of orderedOwners) {
          const path = buildScheduledApiPath("/api/email/scheduled/process-due", owner);
          if (!memberPaths.includes(path)) memberPaths.push(path);
        }
        const orgPath = "/api/email/scheduled/process-due";

        let lastData: ProcessDueResponse | null = null;

        // Fast path: path-scoped member flushes. Org collectionGroup holds a long lock in
        // production and was returning busy:true exactly when mail became due.
        const runMemberFlushes = async () => {
          for (const memberPath of memberPaths) {
            const result = await processOne(memberPath);
            if (result.fatal404) return true;
            lastData = result.data;
            if (result.data?.busy) memberBusy = true;
            // Keep going across owners — due mail may sit under a different root.
            if (sent > 0) break;
          }
          return false;
        };

        if (localDue > 0) {
          if (await runMemberFlushes()) return;
          // Secondary org sweep only if members did not clear due mail (and even if org is busy
          // we already attempted the fast path above).
          if (sent === 0 && dueFound === 0) {
            const orgResult = await processOne(orgPath);
            if (orgResult.fatal404) return;
            lastData = orgResult.data ?? lastData;
            if (orgResult.data?.busy) orgBusy = true;
            // Org busy must not skip members — already ran; if members were empty/busy, retry once.
            if (orgResult.data?.busy && sent === 0) {
              console.log("[scheduled-sync] Org flush busy; retrying member flushes");
              if (await runMemberFlushes()) return;
            }
          }
        } else {
          // Idle: org-wide sweep catches other members' due mail without hammering every owner.
          const orgResult = await processOne(orgPath);
          if (orgResult.fatal404) return;
          lastData = orgResult.data;
          if (orgResult.data?.busy) {
            orgBusy = true;
            // Org lock held — still try active mailbox owners so one slow org scan cannot starve sends.
            if (await runMemberFlushes()) return;
          } else if ((orgResult.data?.dueFound ?? 0) === 0 && memberPaths.length > 0) {
            // Cheap member nudge when org found nothing (legacy rows / path mismatch).
            // Limit to due-priority owners only when idle to avoid N member calls every minute.
            /* idle: org-only is enough unless we know of owners with near-due rows */
          }
        }

        console.log(
          `[scheduled-sync] runLive cycle summary: sent=${sent}, failed=${failed}, skipped=${skipped}, dueFound=${dueFound}, pendingCount=${pendingCount}, busy=${busy}, orgBusy=${orgBusy}, memberBusy=${memberBusy}`,
          lastData?.diagnostics,
        );

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
          localDue > 0 &&
          busy &&
          dueFound === 0 &&
          Date.now() - lastStalledToastAtRef.current >= STALLED_TOAST_GAP_MS
        ) {
          lastStalledToastAtRef.current = Date.now();
          toast.message("Scheduled send is busy", {
            description:
              "Another flush is still running. Retrying with the mailbox owner path — keep this tab open.",
          });
        } else if (
          sent === 0 &&
          !busy &&
          (localDue > 0 || dueFound > 0) &&
          Date.now() - lastStalledToastAtRef.current >= STALLED_TOAST_GAP_MS
        ) {
          lastStalledToastAtRef.current = Date.now();
          const topSkip = Object.entries(skipReasons).sort((a, b) => b[1] - a[1])[0];
          const skipLabel = topSkip?.[0];
          const diag = lastData?.diagnostics;
          const earliest = diag?.earliestPendingScheduledAt;
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
          const blocked =
            (diag?.notBeforeBlocked ?? lastData?.notBeforeBlocked ?? 0) > 0
              ? "Send is deferred (send-gap/quota notBeforeAt). Open Inbox → Scheduled."
              : null;
          const notDueYet =
            dueFound === 0 && earliest
              ? `Server earliest pending send is ${earliest} (now ${diag?.nowIso ?? "unknown"}).`
              : dueFound === 0 && localDue > 0
                ? "Browser thinks mail is due, but the server found no due rows — check Inbox → Scheduled times."
                : null;
          toast.message("Due email still not sent", {
            description:
              skipDesc ??
              blocked ??
              notDueYet ??
              (sawCounts && pendingCount === 0 && localDue > 0
                ? "Followup is marked Scheduled but no pending row was found for this mailbox owner."
                : dueFound > 0 && queued && skipped === 0
                  ? "Found due mail and queued a worker tick — if it stays pending, check worker/cron."
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

    // If scheduled store is empty but we have scheduled followups, hydrate scheduled emails
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
