"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { diffAddedUnreadUids, snapshotUnreadMailUids } from "@/lib/email/snapshot-unread-mail-uids";
import { syncImapInboxHead } from "@/lib/email/sync-imap-inbox-head";
import { syncImapSentHead } from "@/lib/email/sync-imap-sent-head";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import { playAlertSound } from "@/lib/notifications/play-alert-sound";
import type { MailInbound } from "@/lib/email-account-types";
import {
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

/** Poll cron-persisted heads while the app is open (no IMAP). */
const HEADS_POLL_MS = 120_000;
/** On the Inbox route, still do a light IMAP refresh on this interval. */
const INBOX_IMAP_MIN_MS = 5 * 60_000;

/**
 * Keeps the Inbox badge / email store fresh without every open tab hammering IMAP.
 *
 * - Always: hydrate from cron-persisted Firestore heads (`/api/email/inbound-heads`).
 * - Only on `/inbox`: optional IMAP envelope refresh (headsOnly) for the active mailbox.
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
  const lastHeadsAtRef = React.useRef(0);
  const lastImapAtRef = React.useRef(0);

  const hydrateFromServerHeads = React.useCallback(async () => {
    if (isDemo || !sessionHydrated || !currentUserId || !emailServerHydrated) return;
    if (!emailServerSyncEnabled) return;
    if (syncingRef.current) return;
    if (Date.now() - lastHeadsAtRef.current < 15_000) return;

    const st = useEmailAccountStore.getState();
    const configured = st.mailboxes.filter((m) => isImapInboxConfigured(m));
    if (configured.length === 0) return;

    syncingRef.current = true;
    const acct = getActiveMailbox(st);
    const before = snapshotUnreadMailUids(st.inboundByMailbox[acct.id] ?? []);
    const isBootstrap = !bootstrappedRef.current;

    try {
      const forUid = resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: acct.dataOwnerUid,
        selfUid: currentUserId,
      });
      const url = appendMailDataOwnerParam("/api/email/inbound-heads", forUid, currentUserId);
      const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        byMailbox?: Record<
          string,
          { messages?: MailInbound[]; syncedAt?: string | null; mailboxTotal?: number }
        >;
      };
      if (!data.ok || !data.byMailbox) return;

      const reconcile = useEmailAccountStore.getState().reconcileInboundHeadFromSync;
      let anySynced = false;
      for (const [mailboxId, payload] of Object.entries(data.byMailbox)) {
        const rows = Array.isArray(payload.messages) ? payload.messages : [];
        if (rows.length === 0 && !payload.syncedAt) continue;
        anySynced = true;
        reconcile(mailboxId, rows);
      }

      // First-run / local: cron may not have written heads yet - one IMAP seed for the active box.
      if (!anySynced && isImapInboxConfigured(acct)) {
        await syncImapInboxHead({
          mailViewAsUid,
          currentUserId,
          inboxReadOnly: inboxWriteDisabled,
        });
        lastImapAtRef.current = Date.now();
      }

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
      lastHeadsAtRef.current = Date.now();
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

  const runInboxRouteImap = React.useCallback(async () => {
    if (isDemo || !sessionHydrated || !currentUserId || !emailServerHydrated) return;
    if (!emailServerSyncEnabled) return;
    const onInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
    if (!onInbox) return;
    if (syncingRef.current) return;
    if (Date.now() - lastImapAtRef.current < 60_000) return;

    const st = useEmailAccountStore.getState();
    const acct = getActiveMailbox(st);
    if (!isImapInboxConfigured(acct)) return;

    syncingRef.current = true;
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
      lastImapAtRef.current = Date.now();
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
    const hasImap = mailboxes.some((m) => isImapInboxConfigured(m));
    if (!hasImap) return;

    void hydrateFromServerHeads();

    const headsTimer = window.setInterval(() => void hydrateFromServerHeads(), HEADS_POLL_MS);
    const imapTimer = window.setInterval(() => void runInboxRouteImap(), INBOX_IMAP_MIN_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void hydrateFromServerHeads();
        void runInboxRouteImap();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(headsTimer);
      window.clearInterval(imapTimer);
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
    hydrateFromServerHeads,
    runInboxRouteImap,
  ]);

  return null;
}
