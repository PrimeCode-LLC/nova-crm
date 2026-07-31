"use client";

import * as React from "react";
import Link from "next/link";
import { Forward, Loader2, Mail, PenLine, RefreshCw, Reply, ReplyAll, Send, UserRound } from "lucide-react";
import { toast } from "sonner";

import { EmailComposeForm } from "@/components/inbox/email-compose-form";
import {
  MailReaderBody,
  mailReaderContentFromInbound,
  mailReaderContentFromSent,
} from "@/components/inbox/mail-reader-dialog";
import { GlobalEmailFooterPreview } from "@/components/leads/global-email-footer-preview";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { resolveLeadQuality } from "@/lib/intent/compute-quality-score";
import { labelNamesForLead } from "@/lib/intent/apply-quality-score";
import { useQualityOutreachGate } from "@/components/leads/use-quality-outreach-gate";
import type { MailInbound, MailSent } from "@/lib/email-account-types";
import type { Followup, Lead } from "@/lib/types";
import { isLikelyAutoReply } from "@/lib/followup-plan-reply";
import { leadContactEmails } from "@/lib/followup-plans";
import {
  appendGlobalEmailFooter,
  appendMailboxSignature,
} from "@/lib/email/append-mailbox-signature";
import {
  loadLastUsedMailboxPrefs,
  rememberLastUsedMailbox,
  resolveDefaultScheduleMailboxId,
} from "@/lib/email/last-used-mailbox-prefs";
import {
  type ComposeAttachment,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  MAX_COMPOSE_ATTACHMENTS,
  composeAttachmentsFromInbound,
  formatComposeFileSize,
  readFileAsBase64,
} from "@/lib/email/compose-attachments";
import { mergeAiBodyIntoCompose, splitComposerReplyBody } from "@/lib/email/compose-draft-text";
import {
  groupLeadEmailConversations,
  leadEmailMessageAt,
  type LeadEmailMessage,
} from "@/lib/email/lead-email-conversations";
import {
  LEAD_REPLY_SENT_EVENT,
  takePendingLeadReplySent,
  type LeadReplySentDetail,
} from "@/lib/email/lead-reply-events";
import {
  leadMailToLeadEmailMessage,
  mergeLeadEmailMessages,
} from "@/lib/email/lead-mail-map";
import type { LeadMailMessage } from "@/lib/email/lead-mail-types";
import { appendMailDataOwnerParam, resolveMailApiForUserUid } from "@/lib/email/mail-data-owner-query";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import {
  extractEmailAddresses,
  extractReplyAddress,
  applyMailboxHandoffCc,
  rebuildComposeBodyWithMailboxSignature,
  replyAllRecipientLine,
  replyContextForMessage,
  replyRecipientAddress,
  replySubject,
  withMailboxSignature,
} from "@/lib/email/reply-compose";
import { fmtRelative } from "@/lib/format";
import {
  getActiveMailbox,
  isEmailAccountConfigured,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";

type ComposeMode = "compose" | "reply" | "replyAll" | "forward";

/** Header-only sync is enough to match lead emails; bodies load when a thread is opened. */
const LEAD_EMAIL_SYNC_LIMIT = 40;
const LEAD_EMAIL_SYNC_TIMEOUT_MS = 22_000;
/** Cap body downloads during lead Emails tab sync so full threads land in DB without opening each conversation. */
const LEAD_EMAIL_BODY_BACKFILL_LIMIT = 40;

function messageBody(message: LeadEmailMessage): string {
  return message.direction === "inbound"
    ? message.message.bodyText || message.message.preview || ""
    : message.message.body || message.message.preview || "";
}

function messageSnippet(message: LeadEmailMessage): string {
  return messageBody(message).replace(/\s+/g, " ").trim().slice(0, 180);
}

function senderLabel(raw: string): string {
  const match = raw.match(/^([^<]+)</);
  return (match?.[1] ?? raw).trim().replace(/^["']|["']$/g, "") || "Unknown sender";
}

function resolveOutboundFrom(input: {
  messageFrom?: string;
  mailboxEmail?: string;
  fallbackEmail?: string;
}): string {
  const from = input.messageFrom?.trim() || "";
  if (from) return from;
  return input.mailboxEmail?.trim() || input.fallbackEmail?.trim() || "";
}

function bodyToHtml(body: string): string {
  return body
    .split("\n")
    .map((line) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      return `<p>${escaped || "<br/>"}</p>`;
    })
    .join("");
}

function defaultScheduleDatetimeLocal(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function sentAsInbound(message: MailSent): MailInbound {
  return {
    id: message.id,
    uid: message.uid ?? 0,
    subject: message.subject,
    from: message.from,
    replyTo: message.replyTo,
    to: message.to,
    cc: message.cc,
    date: message.sentAt,
    seen: true,
    preview: message.preview ?? message.body.slice(0, 240),
    bodyText: message.body,
    bodyHtml: message.bodyHtml,
    attachments: message.attachments,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    referenceIds: message.referenceIds,
    bodySynced: message.bodySynced,
  };
}

function relevantLeadMessages(input: {
  lead: Lead;
  /** All emails that should match this lead (company + personal). */
  contactEmails?: readonly string[];
  /** @deprecated Prefer contactEmails — still accepted as a single extra address. */
  contactEmail?: string;
  inboundByMailbox: Record<string, MailInbound[]>;
  sent: MailSent[];
  linkedLeadByMessageId: Record<string, string>;
  /** CRM sequence sends that may not yet appear in IMAP Sent. */
  crmSentFollowups?: readonly Followup[];
  /** Fallback From when CRM synthetic rows have no stored sender. */
  fallbackFromEmail?: string;
}): LeadEmailMessage[] {
  const emails = leadContactEmails(input.lead, input.contactEmail, ...(input.contactEmails ?? []));
  const emailSet = new Set(emails);
  const rows: LeadEmailMessage[] = [];
  for (const [mailboxId, messages] of Object.entries(input.inboundByMailbox)) {
    for (const message of messages) {
      const key = `${mailboxId}:in:${message.id}`;
      const manual = input.linkedLeadByMessageId[key] === input.lead.id;
      const automatic =
        emailSet.size > 0 &&
        [...extractEmailAddresses(message.from, message.to, message.cc)].some((e) => emailSet.has(e));
      if (manual || automatic) rows.push({ key, mailboxId, direction: "inbound", message });
    }
  }
  const seenMessageIds = new Set<string>();
  for (const message of input.sent) {
    const manual = input.linkedLeadByMessageId[message.id] === input.lead.id;
    const automatic =
      emailSet.size > 0 &&
      [...extractEmailAddresses(message.from, message.to, message.cc)].some((e) => emailSet.has(e));
    if (manual || automatic) {
      rows.push({ key: message.id, mailboxId: message.mailboxId, direction: "sent", message });
      if (message.messageId) seenMessageIds.add(message.messageId.toLowerCase());
    }
  }
  const primaryTo = emails[0] || "";
  for (const followup of input.crmSentFollowups ?? []) {
    if (followup.leadId !== input.lead.id) continue;
    if (followup.deliveryStatus !== "sent" || !followup.sentAt) continue;
    const mid = followup.sentMessageId?.trim().toLowerCase();
    if (mid && seenMessageIds.has(mid)) continue;
    const id = `crm-sent-${followup.id}`;
    const synthetic: MailSent = {
      id,
      mailboxId: "crm",
      from: input.fallbackFromEmail?.trim() || "",
      to: primaryTo,
      subject: followup.emailSubject?.trim() || followup.title,
      body: followup.messageBody?.trim() || "",
      sentAt: followup.sentAt,
      messageId: followup.sentMessageId,
      preview: (followup.messageBody?.trim() || followup.title).slice(0, 240),
    };
    rows.push({ key: id, mailboxId: "crm", direction: "sent", message: synthetic });
    if (mid) seenMessageIds.add(mid);
  }
  return rows;
}

function leadEmailMessageToPersistPayload(row: LeadEmailMessage) {
  if (row.direction === "inbound") {
    return {
      mailboxId: row.mailboxId,
      direction: "inbound" as const,
      id: row.message.id,
      uid: row.message.uid,
      subject: row.message.subject,
      from: row.message.from,
      to: row.message.to,
      cc: row.message.cc,
      replyTo: row.message.replyTo,
      date: row.message.date,
      seen: row.message.seen,
      preview: row.message.preview,
      bodyText: row.message.bodyText,
      bodyHtml: row.message.bodyHtml,
      bodySynced: row.message.bodySynced,
      messageId: row.message.messageId,
      inReplyTo: row.message.inReplyTo,
      referenceIds: row.message.referenceIds,
    };
  }
  return {
    mailboxId: row.mailboxId,
    direction: "outbound" as const,
    id: row.message.id,
    uid: row.message.uid,
    subject: row.message.subject,
    from: row.message.from,
    to: row.message.to,
    cc: row.message.cc,
    replyTo: row.message.replyTo,
    date: row.message.sentAt,
    seen: true,
    preview: row.message.preview,
    bodyText: row.message.body,
    bodyHtml: row.message.bodyHtml,
    bodySynced: row.message.bodySynced,
    messageId: row.message.messageId,
    inReplyTo: row.message.inReplyTo,
    referenceIds: row.message.referenceIds,
  };
}

export function LeadEmailsPanel({
  lead,
  contactEmail = lead.contactEmail,
  contactEmails,
}: {
  lead: Lead;
  contactEmail?: string;
  /** Company + personal (and any other) emails for matching inbound/outbound. */
  contactEmails?: readonly string[];
}) {
  const workspace = useWorkspace();
  const matchEmails = React.useMemo(
    () => leadContactEmails(lead, contactEmail, ...(contactEmails ?? [])),
    [lead, contactEmail, contactEmails],
  );
  const primaryContactEmail = matchEmails[0] || contactEmail;
  const crmSentFollowups = React.useMemo(
    () =>
      workspace.followups.filter(
        (f) => f.leadId === lead.id && f.deliveryStatus === "sent" && Boolean(f.sentAt),
      ),
    [workspace.followups, lead.id],
  );
  const mailboxes = useEmailAccountStore((state) => state.mailboxes);
  const activeMailboxId = useEmailAccountStore((state) => state.activeMailboxId);
  const globalEmailFooter = useEmailAccountStore((state) => state.globalEmailFooter);
  const inboundByMailbox = useEmailAccountStore((state) => state.inboundByMailbox);
  const sent = useEmailAccountStore((state) => state.sent);
  const linkedLeadByMessageId = useEmailAccountStore((state) => state.linkedLeadByMessageId);
  const inboxWriteDisabled = useEmailAccountStore((state) => state.inboxWriteDisabled);
  const emailServerHydrated = useEmailAccountStore((state) => state.emailServerHydrated);
  const mailViewAsUid = useEmailAccountStore((state) => state.mailViewAsUid);
  const reconcileInboundHeadFromSync = useEmailAccountStore((state) => state.reconcileInboundHeadFromSync);
  const reconcileSentHeadFromSync = useEmailAccountStore((state) => state.reconcileSentHeadFromSync);
  const mergeInboundBodies = useEmailAccountStore((state) => state.mergeInboundBodies);
  const mergeSentBodies = useEmailAccountStore((state) => state.mergeSentBodies);
  const addSent = useEmailAccountStore((state) => state.addSent);
  const addScheduled = useEmailAccountStore((state) => state.addScheduled);
  const upsertDraft = useEmailAccountStore((state) => state.upsertDraft);
  const linkMessageToLead = useEmailAccountStore((state) => state.linkMessageToLead);

  const activeMailbox = React.useMemo(
    () => getActiveMailbox({ mailboxes, activeMailboxId }),
    [activeMailboxId, mailboxes],
  );
  const smtpMailboxes = React.useMemo(
    () => mailboxes.filter((mailbox) => isEmailAccountConfigured(mailbox) || workspace.isDemo),
    [mailboxes, workspace.isDemo],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [highlightKey, setHighlightKey] = React.useState<string | null>(null);
  const [syncingLists, setSyncingLists] = React.useState(false);
  const [storedMessages, setStoredMessages] = React.useState<LeadEmailMessage[]>([]);
  const [loadingStored, setLoadingStored] = React.useState(!workspace.isDemo);
  const storedReadyRef = React.useRef(false);
  const initialSyncKeyRef = React.useRef("");
  const liveMessages = React.useMemo(
    () =>
      relevantLeadMessages({
        lead,
        contactEmails: matchEmails,
        inboundByMailbox,
        sent,
        linkedLeadByMessageId,
        crmSentFollowups,
        fallbackFromEmail: activeMailbox.emailAddress,
      }),
    [
      activeMailbox.emailAddress,
      crmSentFollowups,
      inboundByMailbox,
      lead,
      linkedLeadByMessageId,
      matchEmails,
      sent,
    ],
  );
  const messages = React.useMemo(
    () => mergeLeadEmailMessages(storedMessages, liveMessages),
    [liveMessages, storedMessages],
  );
  const conversations = React.useMemo(() => groupLeadEmailConversations(messages), [messages]);
  const selected =
    conversations.find((conversation) =>
      conversation.messages.some((message) => message.key === selectedId),
    ) ?? null;
  const [loadingBodies, setLoadingBodies] = React.useState(false);
  const [bodyLoadAttempt, setBodyLoadAttempt] = React.useState(0);
  const bodyLoadIdRef = React.useRef(0);
  const [composeMode, setComposeMode] = React.useState<ComposeMode | null>(null);
  const [composeMailboxId, setComposeMailboxId] = React.useState("");
  const [threadMailboxId, setThreadMailboxId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [bcc, setBcc] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [inReplyTo, setInReplyTo] = React.useState<string | undefined>();
  const [referenceIds, setReferenceIds] = React.useState<string[]>([]);
  const [attachments, setAttachments] = React.useState<ComposeAttachment[]>([]);
  const [sending, setSending] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);
  const [scheduledAt, setScheduledAt] = React.useState(defaultScheduleDatetimeLocal);
  const [draftId, setDraftId] = React.useState<string | undefined>();
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [includeFooter, setIncludeFooter] = React.useState(true);

  const selectedMailbox = selected
    ? mailboxes.find((mailbox) => mailbox.id === selected.mailboxId) ??
      (selected.mailboxId === "crm" ? activeMailbox : undefined)
    : undefined;
  const composeMailbox =
    smtpMailboxes.find((mailbox) => mailbox.id === composeMailboxId) ??
    mailboxes.find((mailbox) => mailbox.id === composeMailboxId) ??
    (composeMode && composeMode !== "compose" ? selectedMailbox : undefined) ??
    smtpMailboxes.find((mailbox) => mailbox.id === activeMailbox.id) ??
    smtpMailboxes[0] ??
    activeMailbox;
  const conversationReadOnly = Boolean(
    inboxWriteDisabled ||
      !selectedMailbox ||
      lead.doNotContact,
  );
  const composeReadOnly = Boolean(
    inboxWriteDisabled ||
      !composeMailbox ||
      lead.doNotContact,
  );
  const showComposeFromPicker = smtpMailboxes.length > 1;
  const handoffHint =
    composeMode &&
    composeMode !== "compose" &&
    threadMailboxId &&
    composeMailbox?.id &&
    composeMailbox.id !== threadMailboxId
      ? "Sending from a different mailbox — previous sender stays on Cc when you switch From."
      : null;
  const canComposeNew = Boolean(
    !inboxWriteDisabled &&
      !lead.doNotContact &&
      (workspace.isDemo || smtpMailboxes.length > 0 || isEmailAccountConfigured(activeMailbox)),
  );

  const qualityResult = React.useMemo(
    () =>
      resolveLeadQuality(
        lead,
        workspace.intentPlaybook,
        labelNamesForLead(lead, workspace.crmLabels),
      ),
    [lead, workspace.intentPlaybook, workspace.crmLabels],
  );
  const { confirmOrProceed: confirmQualityOutreach, dialog: qualityGateDialog } =
    useQualityOutreachGate({
      result: qualityResult,
      threshold: workspace.intentPlaybook.outreachThreshold,
    });

  const persistLeadMail = React.useCallback(
    async (rows: LeadEmailMessage[]) => {
      if (workspace.isDemo || rows.length === 0) return;
      const payload = rows
        .filter((row) => row.mailboxId !== "crm")
        .slice(0, 80)
        .map(leadEmailMessageToPersistPayload);
      if (payload.length === 0) return;
      try {
        await fetch("/api/email/lead-mail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ leadId: lead.id, messages: payload }),
        });
      } catch {
        /* best-effort backfill */
      }
    },
    [lead.id, workspace.isDemo],
  );

  const loadStoredLeadMail = React.useCallback(async () => {
    if (workspace.isDemo) {
      storedReadyRef.current = true;
      setLoadingStored(false);
      return;
    }
    setLoadingStored(true);
    try {
      const response = await fetch(`/api/email/lead-mail?leadId=${encodeURIComponent(lead.id)}`, {
        credentials: "same-origin",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        messages?: LeadMailMessage[];
      };
      if (response.ok && data.ok && Array.isArray(data.messages)) {
        setStoredMessages(data.messages.map(leadMailToLeadEmailMessage));
      }
    } catch {
      /* fall back to live mailbox */
    } finally {
      storedReadyRef.current = true;
      setLoadingStored(false);
    }
  }, [lead.id, workspace.isDemo]);

  React.useEffect(() => {
    storedReadyRef.current = false;
    void loadStoredLeadMail();
  }, [loadStoredLeadMail]);

  React.useEffect(() => {
    function applyReplySent(detail: LeadReplySentDetail) {
      if (detail.leadId !== lead.id) return;

      const mailboxId = detail.mailboxId || activeMailbox.id;
      if (detail.to && detail.from && detail.body) {
        const id = addSent({
          mailboxId,
          from: detail.from,
          to: detail.to,
          subject: detail.subject || "(no subject)",
          body: detail.body,
          preview: detail.body.replace(/\s+/g, " ").trim().slice(0, 180),
          messageId: detail.messageId,
          inReplyTo: detail.inReplyTo,
          referenceIds: detail.referenceIds,
        });
        linkMessageToLead(id, lead.id);
        setSelectedId(id);
        setHighlightKey(id);
        window.setTimeout(() => setHighlightKey((prev) => (prev === id ? null : prev)), 8_000);
      }

      void loadStoredLeadMail();
    }

    const pending = takePendingLeadReplySent(lead.id);
    if (pending) applyReplySent(pending);

    function onReplySent(event: Event) {
      const detail = (event as CustomEvent<LeadReplySentDetail>).detail;
      if (!detail) return;
      applyReplySent(detail);
    }

    window.addEventListener(LEAD_REPLY_SENT_EVENT, onReplySent);
    return () => window.removeEventListener(LEAD_REPLY_SENT_EVENT, onReplySent);
  }, [
    activeMailbox.id,
    addSent,
    lead.id,
    linkMessageToLead,
    loadStoredLeadMail,
  ]);

  const syncConversationLists = React.useCallback(
    async (force: boolean) => {
      if (workspace.isDemo || !emailServerHydrated) return;
      // Wait for lead-local store so we can skip IMAP when history is already persisted.
      if (!force && !storedReadyRef.current) return;
      const eligible = mailboxes.filter(isImapInboxConfigured);
      const syncKey = eligible.map((mailbox) => mailbox.id).sort().join("|");
      if (!force && initialSyncKeyRef.current === syncKey) return;

      const store = useEmailAccountStore.getState();
      const jobs: Array<{ mailbox: (typeof eligible)[number]; folder: "inbox" | "sent" }> = [];
      for (const mailbox of eligible) {
        const hasInbox = (store.inboundByMailbox[mailbox.id]?.length ?? 0) > 0;
        const hasServerSent = store.sent.some(
          (message) => message.mailboxId === mailbox.id && message.uid != null,
        );
        if (force || !hasInbox) jobs.push({ mailbox, folder: "inbox" });
        if (force || !hasServerSent) jobs.push({ mailbox, folder: "sent" });
      }

      // Always refresh INBOX heads so new replies (incl. OOO) appear even when
      // durable lead mail already has older outbound history. Sent can wait for Refresh.
      if (!force && storedMessages.length > 0) {
        for (let i = jobs.length - 1; i >= 0; i--) {
          if (jobs[i]?.folder === "sent") jobs.splice(i, 1);
        }
      }
      if (!force) initialSyncKeyRef.current = syncKey;
      if (jobs.length === 0) return;

      setSyncingLists(true);
      let firstError = "";
      const queue = [...jobs];
      const worker = async () => {
        while (queue.length > 0) {
          const job = queue.shift();
          if (!job) return;
          const { mailbox, folder } = job;
          try {
            const forUid = resolveMailApiForUserUid({
              mailViewAsUid,
              activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
              selfUid: workspace.currentUserId ?? "",
            });
            const url = appendMailDataOwnerParam(
              "/api/email/imap-fetch",
              forUid,
              workspace.currentUserId ?? "",
            );
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              signal: AbortSignal.timeout(LEAD_EMAIL_SYNC_TIMEOUT_MS),
              body: JSON.stringify({
                mailboxId: mailbox.id,
                folder,
                limit: LEAD_EMAIL_SYNC_LIMIT,
                offset: 0,
                headsOnly: true,
                imap: {
                  host: mailbox.imap.host,
                  port: mailbox.imap.port,
                  secure: mailbox.imap.secure,
                  user: mailbox.imap.user,
                  pass: mailbox.imap.password,
                },
              }),
            });
            const data = (await response.json()) as {
              ok?: boolean;
              error?: string;
              messages?: MailInbound[];
            };
            if (!response.ok || !data.ok) throw new Error(data.error || "Could not refresh mail");
            const rows = Array.isArray(data.messages) ? data.messages : [];
            if (folder === "inbox") reconcileInboundHeadFromSync(mailbox.id, rows);
            else reconcileSentHeadFromSync(mailbox.id, rows);
          } catch (error) {
            if (!firstError) {
              firstError =
                error instanceof Error
                  ? error.name === "TimeoutError" || error.name === "AbortError"
                    ? "Mailbox check timed out - try Refresh or open Inbox."
                    : error.message
                  : "Could not refresh mail";
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(2, jobs.length) }, () => worker()),
      );
      setSyncingLists(false);
      if (firstError && force) toast.error("Couldn’t refresh lead emails", { description: firstError });

      let matched = relevantLeadMessages({
        lead,
        contactEmails: matchEmails,
        inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
        sent: useEmailAccountStore.getState().sent,
        linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
        crmSentFollowups,
      });

      // Backfill full bodies for lead-matched heads so complete threads persist in DB.
      type BodyJob = { mailboxId: string; folder: "inbox" | "sent"; uids: number[] };
      const bodyJobsByKey = new Map<string, BodyJob>();
      let bodyBudget = LEAD_EMAIL_BODY_BACKFILL_LIMIT;
      const unsynced = matched
        .filter((row) => {
          if (row.mailboxId === "crm") return false;
          if (row.message.bodySynced !== false) return false;
          return row.message.uid != null;
        })
        .sort((a, b) => {
          const ad = a.direction === "inbound" ? a.message.date : a.message.sentAt;
          const bd = b.direction === "inbound" ? b.message.date : b.message.sentAt;
          return bd.localeCompare(ad);
        });
      for (const row of unsynced) {
        if (bodyBudget <= 0) break;
        const uid = row.message.uid;
        if (uid == null) continue;
        const folder = row.direction === "inbound" ? "inbox" : "sent";
        const key = `${row.mailboxId}:${folder}`;
        const existing = bodyJobsByKey.get(key);
        if (existing) {
          if (existing.uids.includes(uid)) continue;
          existing.uids.push(uid);
        } else {
          bodyJobsByKey.set(key, { mailboxId: row.mailboxId, folder, uids: [uid] });
        }
        bodyBudget -= 1;
      }

      for (const job of bodyJobsByKey.values()) {
        const mailbox = mailboxes.find((m) => m.id === job.mailboxId);
        if (!mailbox || !isImapInboxConfigured(mailbox)) continue;
        try {
          const forUid = resolveMailApiForUserUid({
            mailViewAsUid,
            activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
            selfUid: workspace.currentUserId ?? "",
          });
          const url = appendMailDataOwnerParam(
            "/api/email/imap-fetch-bodies",
            forUid,
            workspace.currentUserId ?? "",
          );
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            signal: AbortSignal.timeout(LEAD_EMAIL_SYNC_TIMEOUT_MS),
            body: JSON.stringify({
              mailboxId: mailbox.id,
              folder: job.folder,
              uids: job.uids,
              imap: {
                host: mailbox.imap.host,
                port: mailbox.imap.port,
                secure: mailbox.imap.secure,
                user: mailbox.imap.user,
                pass: mailbox.imap.password,
              },
            }),
          });
          const data = (await response.json()) as {
            ok?: boolean;
            updates?: Array<{ uid: number } & Partial<MailInbound>>;
          };
          if (!response.ok || !data.ok || !data.updates) continue;
          if (job.folder === "inbox") mergeInboundBodies(mailbox.id, data.updates);
          else mergeSentBodies(mailbox.id, data.updates);
        } catch {
          /* heads already persisted; body fill retries on open / next refresh */
        }
      }

      if (bodyJobsByKey.size > 0) {
        matched = relevantLeadMessages({
          lead,
          contactEmails: matchEmails,
          inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
          sent: useEmailAccountStore.getState().sent,
          linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
          crmSentFollowups,
        });
      }
      if (matched.length > 0) void persistLeadMail(matched);
    },
    [
      crmSentFollowups,
      emailServerHydrated,
      lead,
      mailViewAsUid,
      mailboxes,
      matchEmails,
      mergeInboundBodies,
      mergeSentBodies,
      persistLeadMail,
      reconcileInboundHeadFromSync,
      reconcileSentHeadFromSync,
      storedMessages.length,
      workspace.currentUserId,
      workspace.isDemo,
    ],
  );

  React.useEffect(() => {
    if (!storedReadyRef.current && loadingStored) return;
    void Promise.resolve().then(() => syncConversationLists(false));
  }, [loadingStored, syncConversationLists]);

  React.useEffect(() => {
    if (!selected || workspace.isDemo) return;
    const loadId = ++bodyLoadIdRef.current;

    type BodyJob = { mailboxId: string; folder: "inbox" | "sent"; uids: number[] };
    const jobsByKey = new Map<string, BodyJob>();
    for (const row of selected.messages) {
      if (row.message.bodySynced !== false) continue;
      if (row.mailboxId === "crm") continue;
      const uid = row.message.uid;
      if (uid == null) continue;
      const folder = row.direction === "inbound" ? "inbox" : "sent";
      const key = `${row.mailboxId}:${folder}`;
      const existing = jobsByKey.get(key);
      if (existing) existing.uids.push(uid);
      else jobsByKey.set(key, { mailboxId: row.mailboxId, folder, uids: [uid] });
    }
    const jobs = [...jobsByKey.values()];
    if (jobs.length === 0) {
      void Promise.resolve().then(() => {
        if (bodyLoadIdRef.current === loadId) setLoadingBodies(false);
      });
      return;
    }

    let cancelled = false;
    const fetchBodies = async (job: BodyJob) => {
      const mailbox = mailboxes.find((m) => m.id === job.mailboxId);
      if (!mailbox || !isImapInboxConfigured(mailbox)) return;
      const forUid = resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
        selfUid: workspace.currentUserId ?? "",
      });
      const url = appendMailDataOwnerParam(
        "/api/email/imap-fetch-bodies",
        forUid,
        workspace.currentUserId ?? "",
      );
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          mailboxId: mailbox.id,
          folder: job.folder,
          uids: job.uids,
          imap: {
            host: mailbox.imap.host,
            port: mailbox.imap.port,
            secure: mailbox.imap.secure,
            user: mailbox.imap.user,
            pass: mailbox.imap.password,
          },
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        updates?: Array<{ uid: number } & Partial<MailInbound>>;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load full email");
      if (cancelled || !data.updates) return;
      if (job.folder === "inbox") mergeInboundBodies(mailbox.id, data.updates);
      else mergeSentBodies(mailbox.id, data.updates);
    };

    void Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadingBodies(true);
        return Promise.all(jobs.map((job) => fetchBodies(job)));
      })
      .then(() => {
        if (cancelled) return;
        const refreshed = relevantLeadMessages({
          lead,
          contactEmails: matchEmails,
          inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
          sent: useEmailAccountStore.getState().sent,
          linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
          crmSentFollowups,
        });
        const keys = new Set(selected.messages.map((m) => m.key));
        const toPersist = refreshed.filter((m) => keys.has(m.key));
        if (toPersist.length > 0) void persistLeadMail(toPersist);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load full email");
      })
      .finally(() => {
        if (bodyLoadIdRef.current === loadId) setLoadingBodies(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    bodyLoadAttempt,
    crmSentFollowups,
    lead,
    mailViewAsUid,
    mailboxes,
    matchEmails,
    mergeInboundBodies,
    mergeSentBodies,
    persistLeadMail,
    selected,
    workspace.currentUserId,
    workspace.isDemo,
  ]);

  function resetComposer() {
    setComposeMode(null);
    setComposeMailboxId("");
    setThreadMailboxId("");
    setTo("");
    setCc("");
    setBcc("");
    setSubject("");
    setBody("");
    setInReplyTo(undefined);
    setReferenceIds([]);
    setAttachments([]);
    setScheduleEnabled(false);
    setScheduledAt(defaultScheduleDatetimeLocal());
    setDraftId(undefined);
    setIncludeSignature(true);
    setIncludeFooter(Boolean(globalEmailFooter.trim()));
  }

  function changeComposeMailbox(nextId: string) {
    const previous = composeMailbox;
    const next =
      smtpMailboxes.find((mailbox) => mailbox.id === nextId) ??
      mailboxes.find((mailbox) => mailbox.id === nextId);
    if (!next || !previous || next.id === previous.id) {
      setComposeMailboxId(nextId);
      return;
    }
    setComposeMailboxId(nextId);
    if (composeMode && composeMode !== "compose") {
      const handoff = applyMailboxHandoffCc({
        to,
        cc,
        previousMailbox: previous,
        nextMailbox: next,
      });
      setCc(handoff.cc);
      if (handoff.added) {
        toast.message("Kept previous mailbox on Cc", {
          description: `${handoff.added} stays on the thread while you send as ${next.emailAddress || next.label}.`,
        });
      }
      setBody((current) => rebuildComposeBodyWithMailboxSignature(current, next.signature));
    } else if (composeMode === "compose" && includeSignature) {
      setBody((current) => rebuildComposeBodyWithMailboxSignature(current, next.signature));
    }
  }

  function openNewCompose() {
    if (lead.doNotContact) {
      toast.error("This lead is marked do not contact.");
      return;
    }
    if (inboxWriteDisabled) {
      toast.error("Compose is disabled while viewing another member’s mailbox.");
      return;
    }
    confirmQualityOutreach(() => {
      const prefs = loadLastUsedMailboxPrefs(
        workspace.organizationId,
        workspace.currentUserId,
      );
      const defaultId = resolveDefaultScheduleMailboxId({
        mailboxIds: smtpMailboxes.map((item) => item.id),
        lastUsedId: prefs.lastMailboxId,
        activeMailboxId: activeMailbox.id,
      });
      const mailbox = smtpMailboxes[0]
        ? (smtpMailboxes.find((item) => item.id === defaultId) ??
          smtpMailboxes.find((item) => item.id === activeMailbox.id) ??
          smtpMailboxes[0])
        : activeMailbox;
      if (!workspace.isDemo && !isEmailAccountConfigured(mailbox)) {
        toast.error("Configure SMTP in Settings → Email first.");
        return;
      }
      setSelectedId(null);
      setComposeMailboxId(mailbox.id);
      setThreadMailboxId("");
      setTo(primaryContactEmail?.trim() || "");
      setCc("");
      setBcc("");
      setSubject("");
      setBody("");
      setInReplyTo(undefined);
      setReferenceIds([]);
      setAttachments([]);
      setScheduleEnabled(false);
      setScheduledAt(defaultScheduleDatetimeLocal());
      setDraftId(undefined);
      setIncludeSignature(true);
      setIncludeFooter(Boolean(globalEmailFooter.trim()));
      setComposeMode("compose");
    });
  }

  function openComposer(mode: Exclude<ComposeMode, "compose">) {
    if (!selected || !selectedMailbox) return;
    if (lead.doNotContact) {
      toast.error("This lead is marked do not contact.");
      return;
    }
    if (conversationReadOnly) {
      toast.error("You cannot send from this mailbox.");
      return;
    }

    const latest = selected.latest;
    const source = latest.direction === "inbound" ? latest.message : sentAsInbound(latest.message);
    setComposeMailboxId(selectedMailbox.id);
    setThreadMailboxId(selectedMailbox.id);
    setBcc("");
    if (mode === "forward") {
      const original = messageBody(latest);
      setTo("");
      setCc("");
      setSubject(`Fwd: ${selected.subject === "(no subject)" ? "" : selected.subject}`.trim());
      setBody(withMailboxSignature(
        `\n\n---------- Forwarded message ----------\nFrom: ${source.from}\nDate: ${source.date}\nSubject: ${source.subject}\nTo: ${source.to}${source.cc ? `\nCc: ${source.cc}` : ""}\n\n${original.slice(0, 8000)}`,
        selectedMailbox.signature,
      ));
      setInReplyTo(undefined);
      setReferenceIds([]);
      const forwardedAttachments = composeAttachmentsFromInbound(source.attachments);
      setAttachments(forwardedAttachments);
      if ((source.attachments?.length ?? 0) > forwardedAttachments.length) {
        toast.message("Some attachments could not be forwarded", {
          description: "Only attachments available in the browser were added.",
        });
      }
    } else {
      const recipients =
        mode === "replyAll"
          ? latest.direction === "inbound"
            ? replyAllRecipientLine(source, selectedMailbox)
            : { to: source.to, cc: source.cc ?? "" }
          : {
              to:
                latest.direction === "inbound"
                  ? replyRecipientAddress(source)
                  : primaryContactEmail || extractReplyAddress(source.to),
              cc: "",
            };
      if (!recipients.to) {
        toast.error("Could not read a reply address from this conversation.");
        return;
      }
      setTo(recipients.to);
      setCc(recipients.cc);
      setSubject(replySubject(source.subject));
      setBody(withMailboxSignature(
        `\n\n---\nOn ${source.date.slice(0, 10)}, ${source.from} wrote:\n${messageBody(latest).slice(0, 4000)}`,
        selectedMailbox.signature,
      ));
      const context = replyContextForMessage(source);
      setInReplyTo(context.inReplyTo);
      setReferenceIds(context.referenceIds ?? []);
    }
    if (mode !== "forward") setAttachments([]);
    setScheduleEnabled(false);
    setScheduledAt(defaultScheduleDatetimeLocal());
    setDraftId(undefined);
    setComposeMode(mode);
  }

  function resolveOutboundBody(mailbox: NonNullable<typeof composeMailbox>): string {
    if (composeMode !== "compose") return body;
    let outbound = includeSignature
      ? appendMailboxSignature(body, mailbox.signature)
      : body.replace(/\s+$/u, "");
    if (includeFooter) outbound = appendGlobalEmailFooter(outbound, globalEmailFooter);
    return outbound;
  }

  async function addAttachments(files: FileList) {
    const remaining = MAX_COMPOSE_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      toast.error(`You can attach up to ${MAX_COMPOSE_ATTACHMENTS} files.`);
      return;
    }
    const next: ComposeAttachment[] = [];
    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large (max ${formatComposeFileSize(MAX_COMPOSE_ATTACHMENT_BYTES)}).`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(file);
        next.push({
          id: `att-${crypto.randomUUID()}`,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          contentBase64,
        });
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }
    setAttachments((current) => [
      ...current,
      ...next.slice(0, Math.max(0, MAX_COMPOSE_ATTACHMENTS - current.length)),
    ]);
  }

  function normalizedRecipients() {
    const toResult = normalizeRecipientList(to, "To");
    if (!toResult.ok) {
      toast.error(toResult.error);
      return null;
    }
    const ccResult = cc.trim() ? normalizeRecipientList(cc, "Cc") : null;
    if (ccResult && !ccResult.ok) {
      toast.error(ccResult.error);
      return null;
    }
    const bccResult = bcc.trim() ? normalizeRecipientList(bcc, "Bcc") : null;
    if (bccResult && !bccResult.ok) {
      toast.error(bccResult.error);
      return null;
    }
    return {
      to: toResult.addresses.join(", "),
      cc: ccResult?.addresses.join(", "),
      bcc: bccResult?.addresses.join(", "),
    };
  }

  function recordSentMessage(input: {
    mailboxId: string;
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    body: string;
    messageId?: string;
  }) {
    const id = addSent({
      mailboxId: input.mailboxId,
      from: input.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: subject.trim() || "(no subject)",
      body: input.body,
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        contentBase64: attachment.contentBase64,
      })),
      messageId: input.messageId,
      inReplyTo,
      referenceIds,
    });
    linkMessageToLead(id, lead.id);
    workspace.addTimelineEvent({
      id: `te-${crypto.randomUUID()}`,
      leadId: lead.id,
      type: "email_sent",
      actorId: workspace.currentUserId ?? "system",
      summary: `Email sent: ${subject.trim() || "(no subject)"}`,
      createdAt: new Date().toISOString(),
    });
    workspace.bumpLeadActivity(lead.id);
  }

  async function sendNow() {
    if (!composeMailbox || composeReadOnly) return;
    const recipients = normalizedRecipients();
    if (!recipients) return;
    if (!composeMailbox.emailAddress.trim()) {
      toast.error("Set the mailbox From address in Settings → Email.");
      return;
    }
    if (!workspace.isDemo && !isEmailAccountConfigured(composeMailbox)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }

    const outboundBody = resolveOutboundBody(composeMailbox);
    setSending(true);
    try {
      if (workspace.isDemo) {
        recordSentMessage({
          mailboxId: composeMailbox.id,
          from: composeMailbox.emailAddress || "demo@nova.local",
          to: recipients.to,
          cc: recipients.cc,
          bcc: recipients.bcc,
          body: outboundBody,
        });
        rememberLastUsedMailbox(
          workspace.organizationId,
          workspace.currentUserId,
          composeMailbox.id,
        );
        if (lead.replyActionStatus === "pending" && lead.pendingReplyActionId) {
          await workspace.patchLeadAsync(lead.id, {
            pendingReplyActionId: undefined,
            replyActionStatus: "sent",
            nextAction: "Reply sent — wait for their response",
          });
        }
        toast.success("Message saved to Sent (demo)");
        resetComposer();
        return;
      }

      const forUid = resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: composeMailbox.dataOwnerUid,
        selfUid: workspace.currentUserId ?? "",
      });
      const url = appendMailDataOwnerParam("/api/email/send", forUid, workspace.currentUserId ?? "");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          mailboxId: composeMailbox.id,
          leadId: lead.id,
          from: composeMailbox.emailAddress,
          displayName: composeMailbox.displayName,
          replyTo: composeMailbox.replyTo,
          to: recipients.to,
          cc: recipients.cc,
          bcc: recipients.bcc,
          subject: subject.trim(),
          text: outboundBody,
          html: bodyToHtml(outboundBody),
          inReplyTo,
          referenceIds,
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            contentBase64: attachment.contentBase64,
          })),
          smtp: {
            host: composeMailbox.smtp.host,
            port: composeMailbox.smtp.port,
            secure: composeMailbox.smtp.secure,
            user: composeMailbox.smtp.user,
            pass: composeMailbox.smtp.password,
          },
          imap: isImapInboxConfigured(composeMailbox)
            ? {
                host: composeMailbox.imap.host,
                port: composeMailbox.imap.port,
                secure: composeMailbox.imap.secure,
                user: composeMailbox.imap.user,
                pass: composeMailbox.imap.password,
              }
            : undefined,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; messageId?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Send failed");
      recordSentMessage({
        mailboxId: composeMailbox.id,
        from: composeMailbox.emailAddress,
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        body: outboundBody,
        messageId: data.messageId,
      });
      if (draftId) useEmailAccountStore.getState().deleteDraft(draftId);
      rememberLastUsedMailbox(
        workspace.organizationId,
        workspace.currentUserId,
        composeMailbox.id,
      );
      if (lead.replyActionStatus === "pending" && lead.pendingReplyActionId) {
        await workspace.patchLeadAsync(lead.id, {
          pendingReplyActionId: undefined,
          replyActionStatus: "sent",
          nextAction: "Reply sent — wait for their response",
        });
      }
      toast.success("Message sent");
      resetComposer();
    } catch (error) {
      toast.error("Couldn’t send email", {
        description: error instanceof Error ? error.message : "Could not reach the server",
      });
    } finally {
      setSending(false);
    }
  }

  async function scheduleSend() {
    if (!composeMailbox || composeReadOnly) return;
    const recipients = normalizedRecipients();
    if (!recipients) return;
    if (!composeMailbox.emailAddress.trim()) {
      toast.error("Set the mailbox From address in Settings → Email.");
      return;
    }
    if (!workspace.isDemo && !isEmailAccountConfigured(composeMailbox)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60_000) {
      toast.error("Schedule time must be at least 1 minute in the future.");
      return;
    }
    const outboundBody = resolveOutboundBody(composeMailbox);
    setSending(true);
    try {
      const payload = {
        mailboxId: composeMailbox.id,
        from: composeMailbox.emailAddress,
        displayName: composeMailbox.displayName,
        replyTo: composeMailbox.replyTo,
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        subject: subject.trim(),
        body: outboundBody,
        text: outboundBody,
        html: bodyToHtml(outboundBody),
        scheduledAt: date.toISOString(),
        leadId: lead.id,
        inReplyTo,
        referenceIds,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          contentBase64: attachment.contentBase64,
        })),
      };
      if (workspace.isDemo) {
        addScheduled(payload);
      } else {
        const forUid = resolveMailApiForUserUid({
          mailViewAsUid,
          activeMailboxDataOwnerUid: composeMailbox.dataOwnerUid,
          selfUid: workspace.currentUserId ?? "",
        });
        const url = appendMailDataOwnerParam("/api/email/scheduled", forUid, workspace.currentUserId ?? "");
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const data = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not schedule email");
      }
      if (draftId) useEmailAccountStore.getState().deleteDraft(draftId);
      rememberLastUsedMailbox(
        workspace.organizationId,
        workspace.currentUserId,
        composeMailbox.id,
      );
      toast.success("Email scheduled");
      resetComposer();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule email");
    } finally {
      setSending(false);
    }
  }

  function saveDraft() {
    if (!composeMailbox) return;
    const id = upsertDraft({
      id: draftId,
      mailboxId: composeMailbox.id,
      to,
      cc: cc.trim() || undefined,
      bcc: bcc.trim() || undefined,
      subject,
      body,
      attachments,
      inReplyTo,
      referenceIds,
    });
    setDraftId(id);
    toast.success("Draft saved for this session");
  }

  async function runAi(mode: "reply" | "improve") {
    if (mode === "improve") {
      const { userDraft } = splitComposerReplyBody(body);
      if (!userDraft) {
        toast.error("Write a message first, then improvise with AI.");
        return;
      }
    }
    setAiBusy(true);
    try {
      const originalBody = body;
      const response = await fetch("/api/ai/email-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode === "reply" ? "suggest" : "improve",
          composeBody: body.trim() || undefined,
          subject: subject.trim() || undefined,
          ...(mode === "reply" ? { thread: body.trim() || subject || undefined } : {}),
          leadId: lead.id,
          channel: lead.channel,
          profileId: lead.profileId,
          campaignId: lead.campaignId,
          tone: "professional",
          goal: mode === "reply" ? "follow up" : "Polish and improve clarity while keeping my intent and facts",
        }),
      });
      const data = (await response.json()) as { body?: string; mode?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not generate reply");
      setBody(mergeAiBodyIntoCompose(data.body ?? "", originalBody));
      toast.success(
        data.mode === "improve" || mode === "improve"
          ? "Message improved, review before sending"
          : "Draft generated, review before sending",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network error");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      {qualityGateDialog}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-3 text-sm">
            <span>Recent email conversations</span>
            <span className="flex items-center gap-2">
              <Badge variant="secondary">{conversations.length}</Badge>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh lead emails"
                title="Refresh lead emails"
                disabled={syncingLists || workspace.isDemo}
                onClick={() => void syncConversationLists(true)}
              >
                <RefreshCw className={syncingLists ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              </Button>
              <Button
                size="sm"
                disabled={!canComposeNew}
                onClick={openNewCompose}
              >
                <PenLine className="h-3.5 w-3.5" />
                Compose
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/inbox">Open inbox</Link>}
              />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {conversations.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <Mail className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">No recent linked emails</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Messages linked in Inbox or matching{" "}
                {matchEmails.length > 0 ? matchEmails.join(" / ") : "the lead’s email"} appear here.
              </p>
              {loadingStored || syncingLists ? (
                <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {loadingStored ? "Loading saved conversations…" : "Checking mailbox for matches…"}
                </p>
              ) : null}
              <div className="mt-4 flex justify-center">
                <Button
                  size="sm"
                  disabled={!canComposeNew}
                  onClick={openNewCompose}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Compose email
                </Button>
              </div>
            </div>
          ) : (
            conversations.map((conversation) => {
              const latest = conversation.latest;
              const latestMessage = latest.message;
              const from = latestMessage.from;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={
                    conversation.messages.some((m) => m.key === highlightKey)
                      ? "group flex w-full items-start gap-3 rounded-lg border border-primary/50 bg-primary/5 p-3 text-left transition-colors ring-2 ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "group flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                  onClick={() => {
                    resetComposer();
                    setSelectedId(conversation.latest.key);
                  }}
                >
                  <div className="mt-0.5 rounded-full bg-muted p-2">
                    {latest.direction === "inbound" ? (
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Send className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-sm font-medium">{conversation.subject}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {fmtRelative(leadEmailMessageAt(latest))}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {latest.direction === "inbound" ? `From ${senderLabel(from)}` : `Sent to ${latestMessage.to}`}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{messageSnippet(latest) || "No preview"}</p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {conversation.messages.length} message{conversation.messages.length === 1 ? "" : "s"}
                      </Badge>
                      {conversation.hasUnread ? <Badge className="h-5 text-[10px]">Unread</Badge> : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog
        open={composeMode === "compose"}
        onOpenChange={(open) => {
          if (!open) resetComposer();
        }}
      >
        <DialogContent
          className="flex max-h-[min(92vh,880px)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton
        >
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>Compose</DialogTitle>
            <DialogDescription>
              Send through your SMTP account saved in Settings.
              {primaryContactEmail ? ` Prefilled for ${primaryContactEmail}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="shrink-0 space-y-3 border-b px-5 py-3">
            {showComposeFromPicker ? (
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <Select
                  value={composeMailbox?.id}
                  onValueChange={(value) => {
                    if (value) changeComposeMailbox(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select mailbox">
                      {composeMailbox
                        ? composeMailbox.label || composeMailbox.emailAddress || "Mailbox"
                        : "Select mailbox"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {smtpMailboxes.map((mailbox) => (
                      <SelectItem key={mailbox.id} value={mailbox.id}>
                        {mailbox.label || mailbox.emailAddress || mailbox.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <MailboxSignaturePreview
              signature={composeMailbox?.signature}
              includeSignature={includeSignature}
              onIncludeChange={setIncludeSignature}
              mailboxLabel={composeMailbox?.label || composeMailbox?.emailAddress}
              id="lead-compose-include-signature"
            />
            <GlobalEmailFooterPreview
              footer={globalEmailFooter}
              includeFooter={includeFooter}
              onIncludeChange={setIncludeFooter}
              id="lead-compose-include-footer"
            />
          </div>
          <EmailComposeForm
            to={to}
            onToChange={setTo}
            cc={cc}
            onCcChange={setCc}
            bcc={bcc}
            onBccChange={setBcc}
            subject={subject}
            onSubjectChange={setSubject}
            body={body}
            onBodyChange={setBody}
            attachments={attachments}
            onAddAttachments={(files) => void addAttachments(files)}
            onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
            disabled={composeReadOnly}
            sending={sending}
            aiBusy={aiBusy}
            onImproveWithAi={() => void runAi("improve")}
            onGenerateAiDraft={() => void runAi("reply")}
            onSaveDraft={saveDraft}
            scheduleEnabled={scheduleEnabled}
            onScheduleEnabledChange={(checked) => {
              setScheduleEnabled(checked);
              if (checked && !scheduledAt) setScheduledAt(defaultScheduleDatetimeLocal());
            }}
            scheduledAt={scheduledAt}
            onScheduledAtChange={setScheduledAt}
            minimumScheduledAt={defaultScheduleDatetimeLocal()}
            onSend={() => void sendNow()}
            onScheduleSend={() => void scheduleSend()}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            resetComposer();
          }
        }}
      >
        {selected ? (
          <DialogContent
            showCloseButton
            className="flex max-h-[min(94vh,1000px)] w-[min(98vw,1180px)] max-w-[min(98vw,1180px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(98vw,1180px)]"
          >
            <DialogHeader className="shrink-0 space-y-2 border-b px-5 py-4 pr-12 text-left">
              <DialogTitle className="text-base leading-snug">{selected.subject}</DialogTitle>
              <DialogDescription>
                {selected.messages.length} message{selected.messages.length === 1 ? "" : "s"} ·{" "}
                {selectedMailbox?.label ||
                  selectedMailbox?.emailAddress ||
                  activeMailbox.emailAddress ||
                  "Mailbox"}
              </DialogDescription>
              <div className="flex flex-wrap gap-2 pt-1" role="toolbar" aria-label="Conversation actions">
                <Button size="sm" disabled={conversationReadOnly} onClick={() => openComposer("reply")}>
                  <Reply className="h-3.5 w-3.5" /> Reply
                </Button>
                <Button size="sm" variant="secondary" disabled={conversationReadOnly} onClick={() => openComposer("replyAll")}>
                  <ReplyAll className="h-3.5 w-3.5" /> Reply all
                </Button>
                <Button size="sm" variant="secondary" disabled={conversationReadOnly} onClick={() => openComposer("forward")}>
                  <Forward className="h-3.5 w-3.5" /> Forward
                </Button>
                {lead.doNotContact ? (
                  <span className="self-center text-xs text-destructive">Lead is marked do not contact.</span>
                ) : conversationReadOnly ? (
                  <span className="self-center text-xs text-muted-foreground">This mailbox is read-only.</span>
                ) : null}
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loadingBodies ? (
                <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading complete messages…
                </div>
              ) : null}
              <div className="space-y-3">
                {selected.messages.map((row) => {
                  const content =
                    row.direction === "inbound"
                      ? mailReaderContentFromInbound(row.message)
                      : mailReaderContentFromSent(row.message);
                  const date = leadEmailMessageAt(row);
                  const rowMailbox =
                    mailboxes.find((mailbox) => mailbox.id === row.mailboxId) ??
                    (row.mailboxId === "crm" ? activeMailbox : undefined);
                  const fromDisplay =
                    row.direction === "inbound"
                      ? row.message.from?.trim() || "Unknown"
                      : resolveOutboundFrom({
                          messageFrom: row.message.from,
                          mailboxEmail: rowMailbox?.emailAddress,
                          fallbackEmail: activeMailbox.emailAddress,
                        });
                  const toDisplay = row.message.to?.trim() || "";
                  const headline =
                    row.direction === "inbound"
                      ? senderLabel(row.message.from)
                      : fromDisplay
                        ? `${fromDisplay} → ${toDisplay}`
                        : `You → ${toDisplay}`;
                  return (
                    <article key={row.key} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/15 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{headline}</p>
                          <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
                            From {fromDisplay || "Unknown"} · To {toDisplay || "Unknown"}
                            {row.message.cc ? ` · Cc ${row.message.cc}` : ""}
                            {"bcc" in row.message && row.message.bcc ? ` · Bcc ${row.message.bcc}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={row.direction === "inbound" ? "secondary" : "outline"} className="text-[10px]">
                            {row.direction === "inbound" ? "Received" : "Sent"}
                          </Badge>
                          {row.direction === "inbound" &&
                          isLikelyAutoReply({
                            subject: row.message.subject,
                            preview: row.message.preview,
                          }) ? (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">
                              Auto-reply / OOO
                            </Badge>
                          ) : null}
                          <span className="text-[11px] text-muted-foreground">{fmtRelative(date)}</span>
                        </div>
                      </div>
                      <MailReaderBody
                        content={content}
                        className="p-4"
                        bodyLoading={loadingBodies}
                        onRetryBody={() => setBodyLoadAttempt((n) => n + 1)}
                      />
                    </article>
                  );
                })}
              </div>

              {composeMode && composeMode !== "compose" ? (
                <div className="mt-4 rounded-lg border border-primary/25 bg-card px-4 pb-4 shadow-sm">
                  <div className="flex items-center justify-between border-b py-3">
                    <p className="text-sm font-medium capitalize">
                      {composeMode === "replyAll" ? "Reply all" : composeMode}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={resetComposer}>
                      Cancel
                    </Button>
                  </div>
                  <EmailComposeForm
                    compact
                    fromField={
                      showComposeFromPicker ? (
                        <>
                          <Label className="text-xs">From</Label>
                          <Select
                            value={composeMailbox?.id}
                            onValueChange={(value) => {
                              if (value) changeComposeMailbox(value);
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select mailbox">
                                {composeMailbox
                                  ? composeMailbox.label || composeMailbox.emailAddress || "Mailbox"
                                  : "Select mailbox"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {smtpMailboxes.map((mailbox) => (
                                <SelectItem key={mailbox.id} value={mailbox.id}>
                                  {mailbox.label || mailbox.emailAddress || mailbox.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : undefined
                    }
                    to={to}
                    onToChange={setTo}
                    cc={cc}
                    onCcChange={setCc}
                    bcc={bcc}
                    onBccChange={setBcc}
                    handoffHint={handoffHint}
                    subject={subject}
                    onSubjectChange={setSubject}
                    body={body}
                    onBodyChange={setBody}
                    attachments={attachments}
                    onAddAttachments={(files) => void addAttachments(files)}
                    onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                    disabled={composeReadOnly}
                    sending={sending}
                    aiBusy={aiBusy}
                    onImproveWithAi={() => void runAi("improve")}
                    onGenerateAiDraft={() => void runAi("reply")}
                    onSaveDraft={saveDraft}
                    scheduleEnabled={scheduleEnabled}
                    onScheduleEnabledChange={(checked) => {
                      setScheduleEnabled(checked);
                      if (checked && !scheduledAt) setScheduledAt(defaultScheduleDatetimeLocal());
                    }}
                    scheduledAt={scheduledAt}
                    onScheduledAtChange={setScheduledAt}
                    minimumScheduledAt={defaultScheduleDatetimeLocal()}
                    onSend={() => void sendNow()}
                    onScheduleSend={() => void scheduleSend()}
                  />
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
