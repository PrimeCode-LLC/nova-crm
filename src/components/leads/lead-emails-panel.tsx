"use client";

import * as React from "react";
import Link from "next/link";
import { Forward, Loader2, Mail, Paperclip, PenLine, RefreshCw, Reply, ReplyAll, Send, UserRound } from "lucide-react";
import { toast } from "sonner";

import { EmailComposeForm } from "@/components/inbox/email-compose-form";
import { EmailComposeReviewDialog } from "@/components/inbox/email-compose-review-dialog";
import {
  MailReaderBody,
  mailReaderContentFromInbound,
  mailReaderContentFromSent,
  type MailAttachmentResolver,
} from "@/components/inbox/mail-reader-dialog";
import { GlobalEmailFooterPreview } from "@/components/leads/global-email-footer-preview";
import {
  MailAddressLineWithEngagement,
  MailEngagementBadges,
} from "@/components/leads/mail-engagement-status";
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
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import {
  formatTimezoneDisplayLabel,
  isoFromDatetimeLocalInZone,
} from "@/lib/org-timezone";
import {
  defaultScheduleDatetimeLocal as defaultScheduleInZone,
  toDatetimeLocalValue,
} from "@/lib/schedule-followup-email-client";
import { resolveLeadQuality } from "@/lib/intent/compute-quality-score";
import { labelNamesForLead } from "@/lib/intent/apply-quality-score";
import { useQualityOutreachGate } from "@/components/leads/use-quality-outreach-gate";
import type { EmailMailboxSettings, MailInbound, MailSent } from "@/lib/email-account-types";
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
import type { MailTrackingSummary } from "@/lib/email/mail-tracking-types";
import { isSubjectOnlyMailBody } from "@/lib/email/mail-body-stub";
import { hydrateFollowupsMessageBodies } from "@/lib/firestore/fetch-followup-message-body-client";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import {
  LEAD_REPLY_RECEIVED_EVENT,
  LEAD_REPLY_SENT_EVENT,
  takePendingLeadReplyReceived,
  takePendingLeadReplySent,
  type LeadReplyReceivedDetail,
  type LeadReplySentDetail,
} from "@/lib/email/lead-reply-events";
import {
  leadMailToLeadEmailMessage,
  mergeLeadEmailMessages,
  sentNeedsAttachmentBackfill,
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
/** Manual Refresh can wait longer; auto open should fail fast. */
const LEAD_EMAIL_SYNC_TIMEOUT_MS = 22_000;
const LEAD_EMAIL_AUTO_SYNC_TIMEOUT_MS = 12_000;
/** Cap body downloads during lead Emails tab sync so full threads land in DB without opening each conversation. */
const LEAD_EMAIL_BODY_BACKFILL_LIMIT = 40;

function messageBody(message: LeadEmailMessage): string {
  return message.direction === "inbound"
    ? message.message.bodyText || message.message.preview || ""
    : message.message.body || message.message.preview || "";
}

function leadMailAttachmentResolver(input: {
  row: LeadEmailMessage;
  mailboxes: EmailMailboxSettings[];
  mailViewAsUid?: string | null;
  selfUid: string;
}): MailAttachmentResolver | undefined {
  const uid = input.row.message.uid;
  if (uid == null || uid <= 0 || input.row.mailboxId === "crm") return undefined;
  const mailbox = input.mailboxes.find((item) => item.id === input.row.mailboxId);
  if (!mailbox || !isImapInboxConfigured(mailbox)) return undefined;
  return async (att, index) => {
    const forUid = resolveMailApiForUserUid({
      mailViewAsUid: input.mailViewAsUid,
      activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
      selfUid: input.selfUid,
    });
    const url = appendMailDataOwnerParam("/api/email/imap-attachment", forUid, input.selfUid);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        mailboxId: mailbox.id,
        folder: input.row.direction === "inbound" ? "inbox" : "sent",
        uid,
        filename: att.filename,
        index,
        imap: {
          host: mailbox.imap.host,
          port: mailbox.imap.port,
          secure: mailbox.imap.secure,
          user: mailbox.imap.user,
          pass: mailbox.imap.password,
        },
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "Could not load attachment");
    }
    const blob = await response.blob();
    return {
      blob,
      filename: att.filename,
      mimeType: blob.type || att.mimeType || "application/octet-stream",
    };
  };
}

function applyImapBodyUpdatesToStoredRow(
  row: LeadEmailMessage,
  mailboxId: string,
  folder: "inbox" | "sent",
  updates: Array<{ uid: number } & Partial<MailInbound>>,
): LeadEmailMessage {
  if (row.mailboxId !== mailboxId) return row;
  if (folder === "inbox" && row.direction !== "inbound") return row;
  if (folder === "sent" && row.direction !== "sent") return row;
  const uid = row.message.uid;
  if (uid == null || uid <= 0) return row;
  const update = updates.find((item) => item.uid === uid);
  if (!update) return row;
  if (row.direction === "inbound") {
    return {
      ...row,
      message: {
        ...row.message,
        preview: update.preview ?? row.message.preview,
        bodyText: update.bodyText ?? row.message.bodyText,
        ...(update.bodyHtml || row.message.bodyHtml ? { bodyHtml: update.bodyHtml ?? row.message.bodyHtml } : {}),
        bodySynced: update.bodySynced ?? true,
        cc: update.cc ?? row.message.cc,
        replyTo: update.replyTo ?? row.message.replyTo,
        attachments: update.attachments ?? row.message.attachments,
        messageId: update.messageId ?? row.message.messageId,
        inReplyTo: update.inReplyTo ?? row.message.inReplyTo,
        referenceIds: update.referenceIds ?? row.message.referenceIds,
      },
    };
  }
  return {
    ...row,
    message: {
      ...row.message,
      preview: update.preview ?? row.message.preview,
      body: update.bodyText ?? row.message.body,
      ...(update.bodyHtml || row.message.bodyHtml ? { bodyHtml: update.bodyHtml ?? row.message.bodyHtml } : {}),
      bodySynced: update.bodySynced ?? true,
      cc: update.cc ?? row.message.cc,
      replyTo: update.replyTo ?? row.message.replyTo,
      attachments: update.attachments ?? row.message.attachments,
      messageId: update.messageId ?? row.message.messageId,
      inReplyTo: update.inReplyTo ?? row.message.inReplyTo,
      referenceIds: update.referenceIds ?? row.message.referenceIds,
    },
  };
}

function leadEmailNeedsBodyFetch(row: LeadEmailMessage): boolean {
  if (row.mailboxId === "crm") return false;
  const uid = row.message.uid;
  if (uid == null || uid <= 0) return false;
  const subject = row.message.subject;
  const bodyText = row.direction === "inbound" ? row.message.bodyText : row.message.body;
  const stub = isSubjectOnlyMailBody({
    subject,
    bodyText,
    bodyHtml: row.message.bodyHtml,
  });
  if (row.message.bodySynced === false || stub) return true;
  return row.message.attachments === undefined;
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

function defaultScheduleDatetimeLocal(timeZone: string): string {
  return defaultScheduleInZone(undefined, timeZone);
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
    const subject = followup.emailSubject?.trim() || followup.title;
    const body = followup.messageBody?.trim() || "";
    const synthetic: MailSent = {
      id,
      mailboxId: "crm",
      from: input.fallbackFromEmail?.trim() || "",
      to: primaryTo,
      subject,
      body,
      sentAt: followup.sentAt,
      messageId: followup.sentMessageId,
      preview: (body || followup.title).slice(0, 240),
      bodySynced:
        Boolean(body) &&
        !isSubjectOnlyMailBody({
          subject,
          bodyText: body,
        }),
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
      attachments: row.message.attachments,
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
    attachments: row.message.attachments,
  };
}

export function LeadEmailsPanel({
  lead,
  contactEmail = lead.contactEmail,
  contactEmails,
  /** When false (hidden tab), skip IMAP; durable store still prefetches. */
  active = true,
}: {
  lead: Lead;
  contactEmail?: string;
  /** Company + personal (and any other) emails for matching inbound/outbound. */
  contactEmails?: readonly string[];
  active?: boolean;
}) {
  const workspace = useWorkspace();
  const timeZone = useOrgTimezone();
  const timezoneLabel = formatTimezoneDisplayLabel(timeZone);
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
  const [hydratedFollowupBodies, setHydratedFollowupBodies] = React.useState<Record<string, string>>(
    {},
  );
  React.useEffect(() => {
    setHydratedFollowupBodies({});
  }, [lead.id]);
  React.useEffect(() => {
    if (!active || workspace.isDemo) return;
    const toFetch = crmSentFollowups.filter(
      (f) => f.hasMessageBody && !f.messageBody?.trim() && hydratedFollowupBodies[f.id] === undefined,
    );
    if (toFetch.length === 0) return;
    let cancelled = false;
    void hydrateFollowupsMessageBodies(toFetch).then((rows) => {
      if (cancelled) return;
      setHydratedFollowupBodies((prev) => {
        const next = { ...prev };
        for (const row of rows) next[row.id] = row.messageBody?.trim() || "";
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, crmSentFollowups, hydratedFollowupBodies, workspace.isDemo]);
  const crmSentFollowupsHydrated = React.useMemo(
    () =>
      crmSentFollowups.map((f) => {
        if (f.messageBody?.trim()) return f;
        const body = hydratedFollowupBodies[f.id];
        return body ? { ...f, messageBody: body, hasMessageBody: undefined } : f;
      }),
    [crmSentFollowups, hydratedFollowupBodies],
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
  const attachmentBackfillAttemptedRef = React.useRef(new Set<string>());
  const attachmentBackfillInflightRef = React.useRef(new Set<string>());
  const liveMessages = React.useMemo(
    () =>
      relevantLeadMessages({
        lead,
        contactEmails: matchEmails,
        inboundByMailbox,
        sent,
        linkedLeadByMessageId,
        crmSentFollowups: crmSentFollowupsHydrated,
        fallbackFromEmail: activeMailbox.emailAddress,
      }),
    [
      activeMailbox.emailAddress,
      crmSentFollowupsHydrated,
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
  const [trackingByMessageId, setTrackingByMessageId] = React.useState<
    Record<string, MailTrackingSummary>
  >({});
  const trackingRequestIdRef = React.useRef(0);

  const outboundTrackingMessageIds = React.useMemo(
    () =>
      [
        ...new Set(
          conversations
            .flatMap((c) => c.messages)
            .filter((m) => m.direction === "sent")
            .map((m) => normalizeMessageId(m.message.messageId))
            .filter((id): id is string => Boolean(id)),
        ),
      ].slice(0, 100),
    [conversations],
  );

  const loadMailTracking = React.useCallback(async () => {
    if (workspace.isDemo) {
      setTrackingByMessageId({});
      return;
    }
    const ids = outboundTrackingMessageIds;
    if (ids.length === 0) {
      setTrackingByMessageId({});
      return;
    }
    const requestId = ++trackingRequestIdRef.current;
    try {
      const res = await fetch("/api/email/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ messageIds: ids }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        byMessageId?: Record<string, MailTrackingSummary>;
      };
      if (requestId !== trackingRequestIdRef.current) return;
      if (res.ok && data.ok && data.byMessageId) {
        setTrackingByMessageId(data.byMessageId);
      }
    } catch {
      /* optional enrichment */
    }
  }, [outboundTrackingMessageIds, workspace.isDemo]);

  React.useEffect(() => {
    void loadMailTracking();
  }, [loadMailTracking]);

  // Pixel opens stamp lead fields live; badges used to stay on the one-shot fetch above.
  const openFreshnessKey = [
    lead.lastEmailOpenedAt ?? "",
    String(lead.emailOpenCount ?? ""),
  ].join("|");
  const openFreshnessBootRef = React.useRef<{ leadId: string; key: string }>({
    leadId: lead.id,
    key: openFreshnessKey,
  });
  React.useEffect(() => {
    if (openFreshnessBootRef.current.leadId !== lead.id) {
      openFreshnessBootRef.current = { leadId: lead.id, key: openFreshnessKey };
      return;
    }
    if (openFreshnessBootRef.current.key === openFreshnessKey) return;
    openFreshnessBootRef.current = { leadId: lead.id, key: openFreshnessKey };
    if (!lead.lastEmailOpenedAt && !(lead.emailOpenCount && lead.emailOpenCount > 0)) return;
    void loadMailTracking();
  }, [lead.emailOpenCount, lead.id, lead.lastEmailOpenedAt, loadMailTracking, openFreshnessKey]);

  // Re-opens / clicks don't restamp lead fields — light poll + visibility refetch while tab is open.
  React.useEffect(() => {
    if (!active || workspace.isDemo || outboundTrackingMessageIds.length === 0) return;
    const TRACKING_POLL_MS = 45_000;
    const timer = window.setInterval(() => void loadMailTracking(), TRACKING_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadMailTracking();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, loadMailTracking, outboundTrackingMessageIds.length, workspace.isDemo]);

  function trackingFor(message: LeadEmailMessage): MailTrackingSummary | undefined {
    const id = normalizeMessageId(message.message.messageId);
    return id ? trackingByMessageId[id] : undefined;
  }
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
  const [composeReviewOpen, setComposeReviewOpen] = React.useState(false);
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);
  const [scheduledAt, setScheduledAt] = React.useState(() =>
    defaultScheduleDatetimeLocal(timeZone),
  );
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

  const backfillSentAttachmentsFromImap = React.useCallback(
    async (rows: LeadEmailMessage[]) => {
      if (workspace.isDemo) return;
      const byMailbox = new Map<string, string[]>();
      for (const row of rows) {
        if (!sentNeedsAttachmentBackfill(row)) continue;
        const messageId = normalizeMessageId(row.message.messageId);
        if (!messageId) continue;
        const attemptKey = `${row.mailboxId}:${messageId}`;
        if (
          attachmentBackfillAttemptedRef.current.has(attemptKey) ||
          attachmentBackfillInflightRef.current.has(attemptKey)
        ) {
          continue;
        }
        attachmentBackfillInflightRef.current.add(attemptKey);
        const list = byMailbox.get(row.mailboxId) ?? [];
        list.push(messageId);
        byMailbox.set(row.mailboxId, list);
      }
      if (byMailbox.size === 0) return;

      for (const [mailboxId, messageIds] of byMailbox) {
        const mailbox = mailboxes.find((item) => item.id === mailboxId);
        const requestedKeys = [...new Set(messageIds)].map((messageId) => `${mailboxId}:${messageId}`);
        if (!mailbox || !isImapInboxConfigured(mailbox)) {
          for (const key of requestedKeys) attachmentBackfillInflightRef.current.delete(key);
          continue;
        }
        try {
          const forUid = resolveMailApiForUserUid({
            mailViewAsUid,
            activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
            selfUid: workspace.currentUserId ?? "",
          });
          const url = appendMailDataOwnerParam(
            "/api/email/imap-sent-attachments",
            forUid,
            workspace.currentUserId ?? "",
          );
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            signal: AbortSignal.timeout(LEAD_EMAIL_SYNC_TIMEOUT_MS),
            body: JSON.stringify({
              mailboxId,
              leadId: lead.id,
              messageIds: [...new Set(messageIds)].slice(0, 20),
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
            updates?: Array<{
              messageId: string;
              uid: number;
              attachments?: MailInbound["attachments"];
            }>;
          };
          for (const key of requestedKeys) {
            attachmentBackfillInflightRef.current.delete(key);
            if (response.ok) attachmentBackfillAttemptedRef.current.add(key);
          }
          if (!response.ok || !data.ok || !Array.isArray(data.updates) || data.updates.length === 0) {
            continue;
          }
          const byMessageId = new Map(
            data.updates.map((update) => [normalizeMessageId(update.messageId) || update.messageId, update]),
          );
          setStoredMessages((prev) =>
            prev.map((row) => {
              if (row.direction !== "sent" || row.mailboxId !== mailboxId) return row;
              const messageId = normalizeMessageId(row.message.messageId);
              if (!messageId) return row;
              const update = byMessageId.get(messageId);
              if (!update) return row;
              return {
                ...row,
                message: {
                  ...row.message,
                  ...(update.uid > 0 ? { uid: update.uid } : {}),
                  attachments: update.attachments ?? [],
                },
              };
            }),
          );
        } catch {
          for (const key of requestedKeys) attachmentBackfillInflightRef.current.delete(key);
        }
      }
    },
    [lead.id, mailViewAsUid, mailboxes, workspace.currentUserId, workspace.isDemo],
  );

  const loadStoredLeadMail = React.useCallback(async (opts?: { soft?: boolean }) => {
    if (workspace.isDemo) {
      storedReadyRef.current = true;
      setLoadingStored(false);
      return;
    }
    if (!opts?.soft) setLoadingStored(true);
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
      } else if (!opts?.soft) {
        setStoredMessages([]);
      }
    } catch {
      if (!opts?.soft) setStoredMessages([]);
    } finally {
      storedReadyRef.current = true;
      if (!opts?.soft) setLoadingStored(false);
    }
  }, [lead.id, workspace.isDemo]);

  React.useEffect(() => {
    storedReadyRef.current = false;
    initialSyncKeyRef.current = "";
    attachmentBackfillAttemptedRef.current = new Set();
    attachmentBackfillInflightRef.current = new Set();
    setStoredMessages([]);
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

  const syncConversationListsRef = React.useRef<
    ((force: boolean, opts?: { silent?: boolean }) => Promise<void>) | null
  >(null);
  const replyRefreshAtRef = React.useRef(0);

  const refreshAfterInboundReply = React.useCallback(() => {
    const now = Date.now();
    // Watcher event + Firestore lead stamp often fire together — coalesce.
    if (now - replyRefreshAtRef.current < 2_500) return;
    replyRefreshAtRef.current = now;
    void loadStoredLeadMail({ soft: true });
    // Silent force: pull fresh inbox heads so the reply joins the conversation list.
    void syncConversationListsRef.current?.(true, { silent: true });
  }, [loadStoredLeadMail]);

  React.useEffect(() => {
    function applyReplyReceived(detail: LeadReplyReceivedDetail) {
      if (detail.leadId !== lead.id) return;
      refreshAfterInboundReply();
    }

    const pending = takePendingLeadReplyReceived(lead.id);
    if (pending) applyReplyReceived(pending);

    function onReplyReceived(event: Event) {
      const detail = (event as CustomEvent<LeadReplyReceivedDetail>).detail;
      if (!detail) return;
      applyReplyReceived(detail);
    }

    window.addEventListener(LEAD_REPLY_RECEIVED_EVENT, onReplyReceived);
    return () => window.removeEventListener(LEAD_REPLY_RECEIVED_EVENT, onReplyReceived);
  }, [lead.id, refreshAfterInboundReply]);

  // Server/cron/Instantly can stamp the lead before client heads catch up — reload when reply fields change.
  const replyFreshnessKey = [
    lead.lastReplyAt ?? "",
    lead.lastReplyMessageId ?? "",
    lead.lastInboundEmailAt ?? "",
    String(lead.emailMailCount ?? ""),
    lead.replyReviewStatus ?? "",
  ].join("|");
  const replyFreshnessBootRef = React.useRef<{ leadId: string; key: string }>({
    leadId: lead.id,
    key: replyFreshnessKey,
  });
  React.useEffect(() => {
    if (replyFreshnessBootRef.current.leadId !== lead.id) {
      replyFreshnessBootRef.current = { leadId: lead.id, key: replyFreshnessKey };
      return;
    }
    if (replyFreshnessBootRef.current.key === replyFreshnessKey) return;
    replyFreshnessBootRef.current = { leadId: lead.id, key: replyFreshnessKey };
    if (!lead.lastReplyAt && !lead.lastInboundEmailAt) return;
    refreshAfterInboundReply();
  }, [lead.id, lead.lastInboundEmailAt, lead.lastReplyAt, refreshAfterInboundReply, replyFreshnessKey]);

  const syncConversationLists = React.useCallback(
    async (force: boolean, opts?: { silent?: boolean }) => {
      if (workspace.isDemo || !emailServerHydrated) return;
      // Wait for lead-local store so we can skip IMAP when history is already persisted.
      if (!force && !storedReadyRef.current) return;
      const eligible = mailboxes.filter(isImapInboxConfigured);
      const syncKey = `${lead.id}|${eligible.map((mailbox) => mailbox.id).sort().join("|")}`;
      if (!force && initialSyncKeyRef.current === syncKey) return;

      const hasStoredHistory =
        storedMessages.length > 0 || (typeof lead.emailMailCount === "number" && lead.emailMailCount > 0);

      // Durable lead mail is the fast path — don't block the tab on IMAP when history exists.
      // Manual Refresh / reply force still hits the mailbox.
      if (!force && hasStoredHistory) {
        initialSyncKeyRef.current = syncKey;
        const matched = relevantLeadMessages({
          lead,
          contactEmails: matchEmails,
          inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
          sent: useEmailAccountStore.getState().sent,
          linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
          crmSentFollowups: crmSentFollowupsHydrated,
        });
        if (matched.length > 0) void persistLeadMail(matched);
        void backfillSentAttachmentsFromImap(mergeLeadEmailMessages(storedMessages, matched));
        return;
      }

      const store = useEmailAccountStore.getState();
      const jobs: Array<{ mailbox: (typeof eligible)[number]; folder: "inbox" | "sent" }> = [];
      for (const mailbox of eligible) {
        const hasServerSent = store.sent.some(
          (message) => message.mailboxId === mailbox.id && message.uid != null,
        );
        jobs.push({ mailbox, folder: "inbox" });
        if (force || !hasServerSent) jobs.push({ mailbox, folder: "sent" });
      }

      // Prefer the active mailbox so the first match paints sooner.
      jobs.sort((a, b) => {
        const aActive = a.mailbox.id === activeMailbox.id ? 0 : 1;
        const bActive = b.mailbox.id === activeMailbox.id ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        if (a.folder !== b.folder) return a.folder === "inbox" ? -1 : 1;
        return 0;
      });

      if (!force) initialSyncKeyRef.current = syncKey;
      if (jobs.length === 0) return;

      const showBusy = !opts?.silent;
      if (showBusy) setSyncingLists(true);
      let firstError = "";
      const timeoutMs = force ? LEAD_EMAIL_SYNC_TIMEOUT_MS : LEAD_EMAIL_AUTO_SYNC_TIMEOUT_MS;
      try {
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
                signal: AbortSignal.timeout(timeoutMs),
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
        await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
      } finally {
        if (showBusy) setSyncingLists(false);
      }

      if (firstError && force && !opts?.silent) {
        toast.error("Couldn’t refresh lead emails", { description: firstError });
      }

      // Body backfill + persist enrich in the background so the list isn't waiting on IMAP bodies.
      void (async () => {
        let matched = mergeLeadEmailMessages(
          storedMessages,
          relevantLeadMessages({
            lead,
            contactEmails: matchEmails,
            inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
            sent: useEmailAccountStore.getState().sent,
            linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
            crmSentFollowups: crmSentFollowupsHydrated,
          }),
        );

        type BodyJob = { mailboxId: string; folder: "inbox" | "sent"; uids: number[] };
        const bodyJobsByKey = new Map<string, BodyJob>();
        let bodyBudget = LEAD_EMAIL_BODY_BACKFILL_LIMIT;
        const unsynced = matched
          .filter((row) => leadEmailNeedsBodyFetch(row))
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
            setStoredMessages((prev) =>
              prev.map((row) => applyImapBodyUpdatesToStoredRow(row, mailbox.id, job.folder, data.updates ?? [])),
            );
          } catch {
            /* heads already persisted; body fill retries on open / next refresh */
          }
        }

        if (bodyJobsByKey.size > 0) {
          matched = mergeLeadEmailMessages(
            storedMessages,
            relevantLeadMessages({
              lead,
              contactEmails: matchEmails,
              inboundByMailbox: useEmailAccountStore.getState().inboundByMailbox,
              sent: useEmailAccountStore.getState().sent,
              linkedLeadByMessageId: useEmailAccountStore.getState().linkedLeadByMessageId,
              crmSentFollowups: crmSentFollowupsHydrated,
            }),
          );
        }
        if (matched.length > 0) void persistLeadMail(matched);
      })();
    },
    [
      activeMailbox.id,
      backfillSentAttachmentsFromImap,
      crmSentFollowupsHydrated,
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
      storedMessages,
      workspace.currentUserId,
      workspace.isDemo,
    ],
  );

  syncConversationListsRef.current = syncConversationLists;

  React.useEffect(() => {
    if (!active) return;
    if (!storedReadyRef.current && loadingStored) return;
    void Promise.resolve().then(() => syncConversationLists(false));
  }, [active, loadingStored, syncConversationLists]);

  const attachmentBackfillKey = React.useMemo(
    () =>
      messages
        .filter(sentNeedsAttachmentBackfill)
        .map((row) => `${row.mailboxId}:${normalizeMessageId(row.message.messageId) || ""}`)
        .filter((key) => !key.endsWith(":"))
        .sort()
        .join("|"),
    [messages],
  );

  React.useEffect(() => {
    if (!active || workspace.isDemo || loadingStored || !attachmentBackfillKey) return;
    void backfillSentAttachmentsFromImap(messages);
  }, [active, attachmentBackfillKey, backfillSentAttachmentsFromImap, loadingStored, messages, workspace.isDemo]);

  React.useEffect(() => {
    if (!selected || workspace.isDemo) return;
    const loadId = ++bodyLoadIdRef.current;

    type BodyJob = { mailboxId: string; folder: "inbox" | "sent"; uids: number[] };
    const jobsByKey = new Map<string, BodyJob>();
    for (const row of selected.messages) {
      if (!leadEmailNeedsBodyFetch(row)) continue;
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
      setStoredMessages((prev) =>
        prev.map((row) => applyImapBodyUpdatesToStoredRow(row, mailbox.id, job.folder, data.updates ?? [])),
      );
      void persistLeadMail(
        selected.messages.map((row) =>
          applyImapBodyUpdatesToStoredRow(row, mailbox.id, job.folder, data.updates ?? []),
        ),
      );
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
          crmSentFollowups: crmSentFollowupsHydrated,
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
    crmSentFollowupsHydrated,
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
    setScheduledAt(defaultScheduleDatetimeLocal(timeZone));
    setDraftId(undefined);
    setIncludeSignature(true);
    setIncludeFooter(Boolean(globalEmailFooter.trim()));
    setComposeReviewOpen(false);
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
      setScheduledAt(defaultScheduleDatetimeLocal(timeZone));
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
    setScheduledAt(defaultScheduleDatetimeLocal(timeZone));
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
    const date = new Date(isoFromDatetimeLocalInZone(scheduledAt, timeZone));
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

  async function reviewComposeWithAi() {
    const { userDraft } = splitComposerReplyBody(body);
    if (!userDraft) {
      toast.error("Write a message first, then review it with AI.");
      return null;
    }
    try {
      const response = await fetch("/api/ai/email-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "review",
          composeBody: body.trim(),
          subject: subject.trim() || undefined,
          leadId: lead.id,
          channel: lead.channel,
          profileId: lead.profileId,
          campaignId: lead.campaignId,
          tone: "professional",
          goal: "Review my draft, score it, and suggest a stronger version",
        }),
      });
      const data = (await response.json()) as {
        review?: {
          summary: string;
          verdict: "send_ready" | "minor_edits" | "needs_work" | "rewrite";
          overallScore: number;
          dimensions: {
            personalization: number;
            threadFit: number;
            clarity: number;
            cta: number;
            tone: number;
          };
          wins: string[];
          issues: string[];
          improvements: string[];
          improvedBody: string;
        };
        error?: string;
      };
      if (!response.ok) {
        toast.error(data.error ?? "Could not review message");
        return null;
      }
      return data.review ?? null;
    } catch {
      toast.error("Network error");
      return null;
    }
  }

  return (
    <>
      {qualityGateDialog}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2">
              <span>Recent email conversations</span>
              {loadingStored ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </span>
              ) : syncingLists ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking mailbox…
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="secondary">{conversations.length}</Badge>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh lead emails"
                title="Refresh lead emails"
                disabled={syncingLists || workspace.isDemo}
                onClick={() => {
                  attachmentBackfillAttemptedRef.current = new Set();
                  void syncConversationLists(true);
                  void backfillSentAttachmentsFromImap(messages);
                  void loadMailTracking();
                }}
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
              {loadingStored ? (
                <>
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-sm font-medium">Loading saved conversations…</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pulling durable email history for this contact.
                  </p>
                </>
              ) : (
                <>
                  <Mail className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-medium">No recent linked emails</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Messages linked in Inbox or matching{" "}
                    {matchEmails.length > 0 ? matchEmails.join(" / ") : "the lead’s email"} appear here.
                  </p>
                  {syncingLists ? (
                    <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking mailbox for matches in the background…
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
                </>
              )}
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
                      {conversation.messages.some((message) => (message.message.attachments?.length ?? 0) > 0) ? (
                        <Badge variant="outline" className="h-5 gap-1 text-[10px]">
                          <Paperclip className="h-3 w-3" />
                          Attachment
                        </Badge>
                      ) : null}
                      {conversation.hasUnread ? <Badge className="h-5 text-[10px]">Unread</Badge> : null}
                      {(() => {
                        const outbound = conversation.messages.filter((m) => m.direction === "sent");
                        const opened = outbound.some((m) => trackingFor(m)?.opened);
                        const clicked = outbound.some((m) => trackingFor(m)?.clicked);
                        if (!opened && !clicked) return null;
                        const openerEmails = [
                          ...new Set(
                            outbound.flatMap(
                              (m) =>
                                trackingFor(m)?.recipients?.filter((row) => row.openCount > 0).map((row) => row.email) ??
                                [],
                            ),
                          ),
                        ];
                        const openedLabel =
                          openerEmails.length === 1
                            ? `Opened by ${openerEmails[0]}`
                            : openerEmails.length > 1
                              ? `Opened by ${openerEmails.length}`
                              : "Opened";
                        return (
                          <>
                            {opened ? (
                              <Badge variant="outline" className="h-5 max-w-[220px] truncate text-[10px]" title={openerEmails.join(", ")}>
                                {openedLabel}
                              </Badge>
                            ) : null}
                            {clicked ? (
                              <Badge variant="outline" className="h-5 text-[10px]">
                                Clicked
                              </Badge>
                            ) : null}
                          </>
                        );
                      })()}
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
            onReviewWithAi={() => setComposeReviewOpen(true)}
            onImproveWithAi={() => void runAi("improve")}
            onGenerateAiDraft={() => void runAi("reply")}
            onSaveDraft={saveDraft}
            scheduleEnabled={scheduleEnabled}
            onScheduleEnabledChange={(checked) => {
              setScheduleEnabled(checked);
              if (checked && !scheduledAt) setScheduledAt(defaultScheduleDatetimeLocal(timeZone));
            }}
            scheduledAt={scheduledAt}
            onScheduledAtChange={setScheduledAt}
            minimumScheduledAt={toDatetimeLocalValue(new Date(Date.now() + 60_000), timeZone)}
            scheduleTimezoneLabel={timezoneLabel}
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
                      ? mailReaderContentFromInbound(row.message, { mailboxId: row.mailboxId })
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
                          <MailAddressLineWithEngagement
                            from={fromDisplay || "Unknown"}
                            to={toDisplay || "Unknown"}
                            cc={row.message.cc || undefined}
                            bcc={"bcc" in row.message ? row.message.bcc || undefined : undefined}
                            tracking={row.direction === "sent" ? trackingFor(row) : undefined}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={row.direction === "inbound" ? "secondary" : "outline"} className="text-[10px]">
                            {row.direction === "inbound" ? "Received" : "Sent"}
                          </Badge>
                          {row.direction === "sent" ? (
                            <MailEngagementBadges tracking={trackingFor(row)} />
                          ) : null}
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
                        resolveAttachment={leadMailAttachmentResolver({
                          row,
                          mailboxes,
                          mailViewAsUid,
                          selfUid: workspace.currentUserId ?? "",
                        })}
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
                    onReviewWithAi={() => setComposeReviewOpen(true)}
                    onImproveWithAi={() => void runAi("improve")}
                    onGenerateAiDraft={() => void runAi("reply")}
                    onSaveDraft={saveDraft}
                    scheduleEnabled={scheduleEnabled}
                    onScheduleEnabledChange={(checked) => {
                      setScheduleEnabled(checked);
                      if (checked && !scheduledAt) setScheduledAt(defaultScheduleDatetimeLocal(timeZone));
                    }}
                    scheduledAt={scheduledAt}
                    onScheduledAtChange={setScheduledAt}
                    minimumScheduledAt={toDatetimeLocalValue(new Date(Date.now() + 60_000), timeZone)}
                    scheduleTimezoneLabel={timezoneLabel}
                    onSend={() => void sendNow()}
                    onScheduleSend={() => void scheduleSend()}
                  />
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
      <EmailComposeReviewDialog
        open={composeReviewOpen}
        onOpenChange={setComposeReviewOpen}
        onRun={reviewComposeWithAi}
        onApplyImproved={(improvedBody) => {
          setBody((current) => mergeAiBodyIntoCompose(improvedBody, current));
          toast.success("Improved draft applied");
        }}
      />
    </>
  );
}
