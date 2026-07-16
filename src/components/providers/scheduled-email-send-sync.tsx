"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useEmailAccountStore } from "@/stores/email-account-store";

const POLL_MS = 15_000;

/**
 * Local/dev-only sender for due scheduled emails.
 *
 * Production is unchanged: Vercel cron (`/api/cron/scheduled-emails/send`) owns live
 * sends, and the Inbox page still owns demo `processDueScheduledLocal`.
 * This component is a no-op when `NODE_ENV === "production"`.
 */
export function ScheduledEmailSendSync() {
  const { isDemo, sessionHydrated, currentUserId } = useWorkspace();
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const processDueScheduledLocal = useEmailAccountStore((s) => s.processDueScheduledLocal);
  const setScheduled = useEmailAccountStore((s) => s.setScheduled);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const runningRef = React.useRef(false);

  const isLocalDev = process.env.NODE_ENV === "development";

  const runLive = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const qs =
        mailViewAsUid && mailViewAsUid !== currentUserId
          ? `?forUser=${encodeURIComponent(mailViewAsUid)}`
          : "";
      const processRes = await fetch(`/api/email/scheduled/process-due${qs}`, {
        method: "POST",
      });
      const processData = (await processRes.json().catch(() => null)) as {
        ok?: boolean;
        sent?: number;
        failed?: number;
      } | null;
      if (!processData?.ok) return;

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
          setScheduled(listData.items);
        }
      }
    } catch {
      /* best-effort */
    } finally {
      runningRef.current = false;
    }
  }, [currentUserId, mailViewAsUid, setScheduled]);

  React.useEffect(() => {
    // Production: do not poll — cron + existing Inbox demo interval remain the source of truth.
    if (!isLocalDev) return;
    if (!sessionHydrated || !currentUserId) return;

    if (isDemo) {
      processDueScheduledLocal();
      const id = window.setInterval(() => processDueScheduledLocal(), POLL_MS);
      return () => window.clearInterval(id);
    }

    if (!emailServerHydrated) return;

    void runLive();
    const id = window.setInterval(() => void runLive(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void runLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
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

  return null;
}
