"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { ALL_MAILBOXES_ID, useEmailAccountStore } from "@/stores/email-account-store";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { appendMailDataOwnerParam } from "@/lib/email/mail-data-owner-query";
import type { MailFlagId } from "@/lib/email/mail-flags";

/** Fail open so Settings/Inbox are not stuck on "Loading…" forever when Firestore is slow. */
const MAILBOXES_FETCH_TIMEOUT_MS = 90_000;
/** Per-message maps are huge; load after boot so dashboard stays interactive. */
const MESSAGE_MAPS_DEFER_MS = 8_000;

/**
 * Loads saved SMTP/IMAP mailboxes from Firestore after login (live workspace).
 * Demo mode keeps the in-browser template only (no API writes).
 */
export function EmailAccountSync() {
  const { isDemo, sessionHydrated, currentUserId } = useWorkspace();
  const hydrateFromServer = useEmailAccountStore((s) => s.hydrateFromServer);
  const hydrateMessageMaps = useEmailAccountStore((s) => s.hydrateMessageMaps);
  const setEmailServerSyncEnabled = useEmailAccountStore((s) => s.setEmailServerSyncEnabled);
  const setEmailServerHydrated = useEmailAccountStore((s) => s.setEmailServerHydrated);
  const resetForDemoMode = useEmailAccountStore((s) => s.resetForDemoMode);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const setMailViewAsUid = useEmailAccountStore((s) => s.setMailViewAsUid);
  const wasDemoRef = React.useRef(false);
  const prevUserIdRef = React.useRef<string | undefined>(undefined);
  const mapsLoadedRef = React.useRef(false);

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
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), MAILBOXES_FETCH_TIMEOUT_MS);

    mapsLoadedRef.current = false;

    void (async () => {
      try {
        // Lite hydrate: mailbox list + light meta only (no per-message maps).
        const url = appendMailDataOwnerParam("/api/email/mailboxes", mailViewAsUid, currentUserId);
        const res = await fetch(url, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          mailboxes?: EmailMailboxSettings[];
          activeMailboxId?: string;
          linkedLeadByMessageId?: Record<string, string>;
          blockedSenderDomains?: string[];
          globalEmailFooter?: string;
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
                  signature: typeof m.signature === "string" ? m.signature : "",
                  smtp: m.smtp,
                  imap: m.imap,
                  assignedUserIds: m.assignedUserIds ?? [],
                  dailySendLimit: m.dailySendLimit ?? null,
                  connectionType:
                    m.connectionType === "google_workspace" || m.connectionType === "microsoft_outlook"
                      ? m.connectionType
                      : "custom",
                  ...(m.dataOwnerUid ? { dataOwnerUid: m.dataOwnerUid } : {}),
                  // Always set so a cleared server error overwrites a stale client failure.
                  transportError:
                    typeof m.transportError === "string" ? m.transportError.trim().slice(0, 500) : "",
                  ...(m.transportCheckedAt ? { transportCheckedAt: m.transportCheckedAt } : {}),
                  ...(typeof m.googleAuthConnected === "boolean"
                    ? { googleAuthConnected: m.googleAuthConnected }
                    : {}),
                }),
              )
            : [defaultEmailMailboxSettings({ label: "Primary mailbox" })];
        const activeFromServer = (data.activeMailboxId ?? "").trim();
        const active =
          activeFromServer === ALL_MAILBOXES_ID
            ? ALL_MAILBOXES_ID
            : activeFromServer && mailboxes.some((m) => m.id === activeFromServer)
              ? activeFromServer
              : ALL_MAILBOXES_ID;
        hydrateFromServer({
          mailboxes,
          activeMailboxId: active,
          linkedLeadByMessageId: data.linkedLeadByMessageId ?? {},
          blockedSenderDomains: data.blockedSenderDomains ?? [],
          globalEmailFooter: data.globalEmailFooter ?? "",
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
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    // Deferred full maps (lead links / labels / flags) — needed on Inbox + lead email panels.
    const mapsTimer = window.setTimeout(() => {
      if (cancelled || mapsLoadedRef.current) return;
      void (async () => {
        try {
          const base = appendMailDataOwnerParam(
            "/api/email/mailboxes/meta",
            mailViewAsUid,
            currentUserId,
          );
          const res = await fetch(base, { credentials: "same-origin", cache: "no-store" });
          const data = (await res.json()) as {
            ok?: boolean;
            linkedLeadByMessageId?: Record<string, string>;
            labelsByMessageId?: Record<string, string[]>;
            flagByMessageId?: Record<string, string>;
            mailLabels?: { id: string; name: string; color: string }[];
            blockedSenderDomains?: string[];
            globalEmailFooter?: string;
          };
          if (cancelled || !res.ok || !data.ok) return;
          mapsLoadedRef.current = true;
          hydrateMessageMaps({
            linkedLeadByMessageId: data.linkedLeadByMessageId,
            labelsByMessageId: data.labelsByMessageId,
            flagByMessageId: data.flagByMessageId as Record<string, MailFlagId> | undefined,
            mailLabels: data.mailLabels,
            blockedSenderDomains: data.blockedSenderDomains,
            globalEmailFooter: data.globalEmailFooter,
          });
        } catch {
          /* best-effort */
        }
      })();
    }, MESSAGE_MAPS_DEFER_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
      window.clearTimeout(mapsTimer);
    };
  }, [
    isDemo,
    sessionHydrated,
    currentUserId,
    mailViewAsUid,
    hydrateFromServer,
    hydrateMessageMaps,
    resetForDemoMode,
    setEmailServerHydrated,
    setEmailServerSyncEnabled,
  ]);

  return null;
}
