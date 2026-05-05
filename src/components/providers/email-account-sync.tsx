"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useEmailAccountStore } from "@/stores/email-account-store";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import type { EmailMailboxSettings } from "@/lib/email-account-types";

/**
 * Loads saved SMTP/IMAP mailboxes from Firestore after login (live workspace).
 * Demo mode keeps the in-browser template only (no API writes).
 */
export function EmailAccountSync() {
  const { isDemo, sessionHydrated, currentUserId } = useWorkspace();
  const hydrateFromServer = useEmailAccountStore((s) => s.hydrateFromServer);
  const setEmailServerSyncEnabled = useEmailAccountStore((s) => s.setEmailServerSyncEnabled);
  const setEmailServerHydrated = useEmailAccountStore((s) => s.setEmailServerHydrated);
  const resetForDemoMode = useEmailAccountStore((s) => s.resetForDemoMode);

  React.useEffect(() => {
    if (isDemo) {
      resetForDemoMode();
      setEmailServerSyncEnabled(false);
      setEmailServerHydrated(true);
      return;
    }
    if (!sessionHydrated || !currentUserId) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/email/mailboxes", { credentials: "same-origin", cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          mailboxes?: EmailMailboxSettings[];
          activeMailboxId?: string;
          linkedLeadByMessageId?: Record<string, string>;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !Array.isArray(data.mailboxes)) {
          setEmailServerSyncEnabled(false);
          setEmailServerHydrated(true);
          return;
        }
        const mailboxes =
          data.mailboxes.length > 0
            ? data.mailboxes
            : [defaultEmailMailboxSettings({ label: "Primary mailbox" })];
        const activeFromServer = (data.activeMailboxId ?? "").trim();
        const active =
          activeFromServer && mailboxes.some((m) => m.id === activeFromServer)
            ? activeFromServer
            : mailboxes[0].id;
        hydrateFromServer({
          mailboxes,
          activeMailboxId: active,
          linkedLeadByMessageId: data.linkedLeadByMessageId ?? {},
        });
        setEmailServerSyncEnabled(true);
        setEmailServerHydrated(true);
      } catch {
        if (!cancelled) {
          setEmailServerSyncEnabled(false);
          setEmailServerHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    hydrateFromServer,
    resetForDemoMode,
    setEmailServerHydrated,
    setEmailServerSyncEnabled,
  ]);

  return null;
}
