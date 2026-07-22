"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { diffAddedUnreadUids, snapshotUnreadMailUids } from "@/lib/email/snapshot-unread-mail-uids";
import { syncImapInboxHead } from "@/lib/email/sync-imap-inbox-head";
import { syncImapSentHead } from "@/lib/email/sync-imap-sent-head";
import { playAlertSound } from "@/lib/notifications/play-alert-sound";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

function syncIntervalMs(mailboxes: EmailMailboxSettings[], activeMailboxId: string): number {
  const acct = getActiveMailbox({ mailboxes, activeMailboxId });
  const minutes = Math.max(5, Math.min(120, acct.syncIntervalMinutes || 15));
  return minutes * 60 * 1000;
}

/**
 * Polls IMAP on the mailbox sync interval (Settings → Email) app-wide so the Inbox badge
 * and email store stay fresh even when the user is on Dashboard or other routes.
 */
export function InboxBackgroundSync() {
  const pathname = usePathname();
  const { isDemo, sessionHydrated, currentUserId } = useWorkspace();
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const emailServerSyncEnabled = useEmailAccountStore((s) => s.emailServerSyncEnabled);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const inboxWriteDisabled = useEmailAccountStore((s) => s.inboxWriteDisabled);

  const bootstrappedRef = React.useRef(false);
  const syncingRef = React.useRef(false);
  const lastSyncAtRef = React.useRef(0);

  const runSync = React.useCallback(async (opts?: { force?: boolean }) => {
    if (isDemo || !sessionHydrated || !currentUserId || !emailServerHydrated) return;
    if (!emailServerSyncEnabled) return;

    const st = useEmailAccountStore.getState();
    const acct = getActiveMailbox(st);
    if (!isImapInboxConfigured(acct)) return;
    if (syncingRef.current) return;
    // Tab-focus / visibility shouldn't re-hit IMAP if we just synced.
    if (!opts?.force && Date.now() - lastSyncAtRef.current < 60_000) return;

    syncingRef.current = true;
    const before = snapshotUnreadMailUids(st.inboundByMailbox[acct.id] ?? []);
    const isBootstrap = !bootstrappedRef.current;

    try {
      await syncImapInboxHead({
        mailViewAsUid,
        currentUserId,
        inboxReadOnly: inboxWriteDisabled,
      });
      await syncImapSentHead({
        mailViewAsUid,
        currentUserId,
      });
      const after = snapshotUnreadMailUids(
        useEmailAccountStore.getState().inboundByMailbox[acct.id] ?? [],
      );
      if (!isBootstrap) {
        const added = diffAddedUnreadUids(before, after);
        if (added.length > 0) {
          playAlertSound("mail");
          const onInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
          if (!onInbox && document.visibilityState !== "hidden") {
            toast.message(
              added.length === 1 ? "New email" : `${added.length} new emails`,
              {
                description: "Your inbox was updated in the background.",
                duration: 5000,
                action: {
                  label: "Open Inbox",
                  onClick: () => {
                    window.location.href = "/inbox";
                  },
                },
              },
            );
          }
        }
      }
      bootstrappedRef.current = true;
      lastSyncAtRef.current = Date.now();
    } catch {
      /* best-effort */
    } finally {
      syncingRef.current = false;
    }
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    emailServerHydrated,
    emailServerSyncEnabled,
    mailViewAsUid,
    inboxWriteDisabled,
    pathname,
  ]);

  React.useEffect(() => {
    bootstrappedRef.current = false;
  }, [isDemo, currentUserId, activeMailboxId, mailViewAsUid]);

  React.useEffect(() => {
    if (isDemo || !sessionHydrated || !currentUserId || !emailServerHydrated) return;
    if (!emailServerSyncEnabled) return;
    const acct = getActiveMailbox({ mailboxes, activeMailboxId });
    if (!isImapInboxConfigured(acct)) return;

    void runSync({ force: true });

    const ms = syncIntervalMs(mailboxes, activeMailboxId);
    const timer = window.setInterval(() => void runSync({ force: true }), ms);

    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    emailServerHydrated,
    emailServerSyncEnabled,
    activeMailboxId,
    mailViewAsUid,
    mailboxes,
    runSync,
  ]);

  return null;
}
