"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { resolveLeadIdsByEmailClient } from "@/lib/crm-dedupe-client";
import {
  detectHardBounce,
  isDeliveryStatusNotification,
} from "@/lib/email/detect-hard-bounce";
import { leadContactEmails } from "@/lib/followup-plans";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import type { MailInbound } from "@/lib/email-account-types";
import type { Lead } from "@/lib/types";
import {
  getActiveMailbox,
  useEmailAccountStore,
} from "@/stores/email-account-store";

const PROCESSED_KEY = "nova-email-bounce-processed-v2";
/** Don't re-attempt the same DSN more often than this while waiting for body/parse. */
const RETRY_COOLDOWN_MS = 60_000;

function readProcessed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(PROCESSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeProcessed(set: Set<string>) {
  if (typeof window === "undefined") return;
  const trimmed = [...set].slice(-500);
  try {
    window.sessionStorage.setItem(PROCESSED_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

function findLeadIdForBounce(leads: Lead[], failedRecipients: string[]): string | undefined {
  if (failedRecipients.length === 0) return undefined;
  const want = new Set(failedRecipients.map((e) => e.trim().toLowerCase()));
  for (const lead of leads) {
    const emails = leadContactEmails(lead);
    if (emails.some((e) => want.has(e))) return lead.id;
  }
  return undefined;
}

async function ensureBounceBody(input: {
  mailboxId: string;
  message: MailInbound;
  forUid: string | null;
  currentUserId: string;
  imap: { host: string; port: number; secure: boolean; user: string; pass: string };
}): Promise<MailInbound> {
  const { message } = input;
  if (message.bodySynced !== false && ((message.bodyText ?? "").trim() || (message.bodyHtml ?? "").trim())) {
    return message;
  }
  if ((message.bodyText ?? "").trim().length > 80 || (message.bodyHtml ?? "").trim().length > 80) {
    return message;
  }
  if (message.uid == null) return message;

  try {
    const url = appendMailDataOwnerParam(
      "/api/email/imap-fetch-bodies",
      input.forUid,
      input.currentUserId,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailboxId: input.mailboxId,
        folder: "inbox",
        uids: [message.uid],
        imap: input.imap,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      updates?: Array<{
        uid: number;
        bodyText?: string;
        bodyHtml?: string;
        preview?: string;
        bodySynced?: boolean;
      }>;
    };
    if (!data.ok || !Array.isArray(data.updates) || data.updates.length === 0) return message;
    const upd = data.updates.find((u) => u.uid === message.uid) ?? data.updates[0];
    if (!upd) return message;
    useEmailAccountStore.getState().mergeInboundBodies(input.mailboxId, [upd]);
    return {
      ...message,
      bodyText: upd.bodyText ?? message.bodyText,
      bodyHtml: upd.bodyHtml ?? message.bodyHtml,
      preview: upd.preview ?? message.preview,
      bodySynced: true,
    };
  } catch {
    return message;
  }
}

/**
 * When IMAP sync brings in a mailer-daemon / DSN hard bounce, apply CRM side effects
 * (contact bounced, review task, pause sequence) via the idempotent server API.
 */
export function EmailBounceWatcher() {
  const { isDemo, sessionHydrated, currentUserId, leads, contacts, requestWorkspaceGroups } =
    useWorkspace();
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const processedRef = React.useRef(readProcessed());
  const inFlightRef = React.useRef(new Set<string>());
  const nextRetryAtRef = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    requestWorkspaceGroups(["directory"]);
  }, [requestWorkspaceGroups]);

  React.useEffect(() => {
    if (!sessionHydrated || !currentUserId || isDemo || !emailServerHydrated) return;

    const acct = getActiveMailbox({ mailboxes, activeMailboxId });
    const messages = inboundByMailbox[acct.id] ?? [];
    const forUid = resolveMailApiForUserUid({
      mailViewAsUid,
      activeMailboxDataOwnerUid: acct.dataOwnerUid,
      selfUid: currentUserId,
    });
    const now = Date.now();
    let started = 0;
    const MAX_BOUNCE_BODY_FETCHES = 2;

    for (const raw of messages) {
      const mid = `${acct.id}:in:${raw.id}`;
      if (processedRef.current.has(mid) || inFlightRef.current.has(mid)) continue;
      const retryAt = nextRetryAtRef.current.get(mid) ?? 0;
      if (retryAt > now) continue;
      if (!isDeliveryStatusNotification(raw)) continue;
      if (started >= MAX_BOUNCE_BODY_FETCHES) break;
      started += 1;

      inFlightRef.current.add(mid);
      void (async () => {
        try {
          const message = await ensureBounceBody({
            mailboxId: acct.id,
            message: raw,
            forUid,
            currentUserId,
            imap: {
              host: acct.imap.host,
              port: acct.imap.port,
              secure: acct.imap.secure,
              user: acct.imap.user,
              pass: acct.imap.password,
            },
          });

          const bounce = detectHardBounce(message);
          if (!bounce) {
            processedRef.current.add(mid);
            writeProcessed(processedRef.current);
            nextRetryAtRef.current.delete(mid);
            return;
          }

          // Wait for body sync before applying - empty recipient = incomplete parse.
          if (
            bounce.bounceKind === "hard" &&
            bounce.failedRecipients.length === 0 &&
            !bounce.originalMessageId
          ) {
            nextRetryAtRef.current.set(mid, Date.now() + RETRY_COOLDOWN_MS);
            return;
          }

          let leadIdHint = findLeadIdForBounce(leads, bounce.failedRecipients);
          if (!leadIdHint && bounce.failedRecipients.length > 0) {
            const want = new Set(bounce.failedRecipients.map((e) => e.trim().toLowerCase()));
            const contact = contacts.find((c) => {
              const emails = [c.email, c.personalEmail]
                .map((e) => e?.trim().toLowerCase())
                .filter(Boolean) as string[];
              return emails.some((e) => want.has(e));
            });
            if (contact) {
              leadIdHint = leads.find((l) => l.contactId === contact.id)?.id;
            }
          }
          if (
            !leadIdHint &&
            isLiveCrmSnapshotDisabled(isDemo) &&
            bounce.failedRecipients.length > 0
          ) {
            const byEmail = await resolveLeadIdsByEmailClient(bounce.failedRecipients);
            leadIdHint = Object.values(byEmail)[0];
          }

          const url = appendMailDataOwnerParam(
            "/api/email/bounces/apply",
            forUid,
            currentUserId,
          );
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mailboxId: acct.id,
              inboundMessageId: String(raw.id),
              bounceKind: bounce.bounceKind,
              failedRecipients: bounce.failedRecipients,
              originalMessageId: bounce.originalMessageId,
              reason: bounce.reason,
              subject: message.subject,
              leadIdHint,
            }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            error?: string;
            alreadyProcessed?: boolean;
            skippedSoft?: boolean;
            leadId?: string;
            taskId?: string;
            planPaused?: boolean;
          };

          if (!data.ok) {
            // Incomplete body / transient - leave unprocessed for next sync.
            nextRetryAtRef.current.set(mid, Date.now() + RETRY_COOLDOWN_MS);
            return;
          }

          processedRef.current.add(mid);
          writeProcessed(processedRef.current);
          nextRetryAtRef.current.delete(mid);

          if (data.alreadyProcessed || data.skippedSoft) return;

          if (bounce.bounceKind === "hard" && (data.leadId || leadIdHint)) {
            toast.message("Email bounced - review prospect", {
              description: bounce.failedRecipients[0]
                ? `${bounce.failedRecipients[0]}: find a valid email and resume outreach.`
                : "Marked bounced and queued a review task.",
              duration: 9000,
            });
          }
        } catch {
          nextRetryAtRef.current.set(mid, Date.now() + RETRY_COOLDOWN_MS);
        } finally {
          inFlightRef.current.delete(mid);
        }
      })();
    }
  }, [
    sessionHydrated,
    currentUserId,
    isDemo,
    emailServerHydrated,
    inboundByMailbox,
    mailboxes,
    activeMailboxId,
    mailViewAsUid,
    leads,
    contacts,
  ]);

  return null;
}
