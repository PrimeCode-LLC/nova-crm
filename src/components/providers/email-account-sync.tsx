"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useEmailAccountStore } from "@/stores/email-account-store";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { appendMailDataOwnerParam } from "@/lib/email/mail-data-owner-query";
import type { MailFlagId } from "@/lib/email/mail-flags";

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
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const setMailViewAsUid = useEmailAccountStore((s) => s.setMailViewAsUid);
  const wasDemoRef = React.useRef(false);
  const prevUserIdRef = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== currentUserId) {
      setMailViewAsUid(null);
    }
    prevUserIdRef.current = currentUserId;
  }, [currentUserId, setMailViewAsUid]);

  React.useEffect(() => {
    if (isDemo) {
      if (!wasDemoRef.current) {
        resetForDemoMode();
      }
      wasDemoRef.current = true;
      setEmailServerSyncEnabled(false);
      setEmailServerHydrated(true);
      return;
    }
    wasDemoRef.current = false;
    if (!sessionHydrated || !currentUserId) return;

    let cancelled = false;
    void (async () => {
      try {
        const url = appendMailDataOwnerParam("/api/email/mailboxes", mailViewAsUid, currentUserId);
        const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        const data = (await res.json()) as {
          ok?: boolean;
          mailboxes?: EmailMailboxSettings[];
          activeMailboxId?: string;
          linkedLeadByMessageId?: Record<string, string>;
          blockedSenderDomains?: string[];
          mailLabels?: { id: string; name: string; color: string }[];
          labelsByMessageId?: Record<string, string[]>;
          flagByMessageId?: Record<string, string>;
          mailboxReadOnly?: boolean;
          mailboxAccountReadOnly?: boolean;
          dataOwnerUid?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !Array.isArray(data.mailboxes)) {
          setEmailServerSyncEnabled(false);
          setEmailServerHydrated(true);
          return;
        }
        const mailboxes =
          data.mailboxes.length > 0
            ? data.mailboxes.map((m) =>
                defaultEmailMailboxSettings({
                  ...m,
                  smtp: m.smtp,
                  imap: m.imap,
                  assignedUserIds: m.assignedUserIds ?? [],
                  dailySendLimit: m.dailySendLimit ?? null,
                  connectionType: m.connectionType === "google_workspace" ? "google_workspace" : "custom",
                  ...(m.dataOwnerUid ? { dataOwnerUid: m.dataOwnerUid } : {}),
                }),
              )
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
          blockedSenderDomains: data.blockedSenderDomains ?? [],
          mailLabels: data.mailLabels ?? [],
          labelsByMessageId: data.labelsByMessageId ?? {},
          flagByMessageId: (data.flagByMessageId ?? {}) as Record<string, MailFlagId>,
          mailboxReadOnly: data.mailboxReadOnly,
          mailboxAccountReadOnly: data.mailboxAccountReadOnly,
        });
        const readOnly = Boolean(data.mailboxReadOnly);
        setEmailServerSyncEnabled(!readOnly);
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
    mailViewAsUid,
    hydrateFromServer,
    resetForDemoMode,
    setEmailServerHydrated,
    setEmailServerSyncEnabled,
  ]);

  return null;
}
