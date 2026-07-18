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
import type { MailInbound, MailSent } from "@/lib/email-account-types";
import {
  appendGlobalEmailFooter,
  appendMailboxSignature,
} from "@/lib/email/append-mailbox-signature";
import {
  type ComposeAttachment,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  MAX_COMPOSE_ATTACHMENTS,
  composeAttachmentsFromInbound,
  formatComposeFileSize,
  readFileAsBase64,
} from "@/lib/email/compose-attachments";
import {
  groupLeadEmailConversations,
  leadEmailMessageAt,
  type LeadEmailMessage,
} from "@/lib/email/lead-email-conversations";
import { appendMailDataOwnerParam, resolveMailApiForUserUid } from "@/lib/email/mail-data-owner-query";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import {
  extractEmailAddresses,
  extractReplyAddress,
  replyAllRecipientLine,
  replyContextForMessage,
  replyRecipientAddress,
  replySubject,
  withMailboxSignature,
} from "@/lib/email/reply-compose";
import { fmtRelative } from "@/lib/format";
import type { Lead } from "@/lib/types";
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
  contactEmail?: string;
  inboundByMailbox: Record<string, MailInbound[]>;
  sent: MailSent[];
  linkedLeadByMessageId: Record<string, string>;
}): LeadEmailMessage[] {
  const email = input.contactEmail?.trim().toLowerCase() ?? "";
  const rows: LeadEmailMessage[] = [];
  for (const [mailboxId, messages] of Object.entries(input.inboundByMailbox)) {
    for (const message of messages) {
      const key = `${mailboxId}:in:${message.id}`;
      const manual = input.linkedLeadByMessageId[key] === input.lead.id;
      const automatic =
        Boolean(email) && extractEmailAddresses(message.from, message.to, message.cc).has(email);
      if (manual || automatic) rows.push({ key, mailboxId, direction: "inbound", message });
    }
  }
  for (const message of input.sent) {
    const manual = input.linkedLeadByMessageId[message.id] === input.lead.id;
    const automatic =
      Boolean(email) && extractEmailAddresses(message.from, message.to, message.cc).has(email);
    if (manual || automatic) {
      rows.push({ key: message.id, mailboxId: message.mailboxId, direction: "sent", message });
    }
  }
  return rows;
}

export function LeadEmailsPanel({
  lead,
  contactEmail = lead.contactEmail,
}: {
  lead: Lead;
  contactEmail?: string;
}) {
  const workspace = useWorkspace();
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

  const messages = React.useMemo(
    () => relevantLeadMessages({ lead, contactEmail, inboundByMailbox, sent, linkedLeadByMessageId }),
    [contactEmail, inboundByMailbox, lead, linkedLeadByMessageId, sent],
  );
  const conversations = React.useMemo(() => groupLeadEmailConversations(messages), [messages]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [syncingLists, setSyncingLists] = React.useState(false);
  const initialSyncKeyRef = React.useRef("");
  const selected =
    conversations.find((conversation) =>
      conversation.messages.some((message) => message.key === selectedId),
    ) ?? null;
  const [loadingBodies, setLoadingBodies] = React.useState(false);
  const bodyLoadIdRef = React.useRef(0);
  const [composeMode, setComposeMode] = React.useState<ComposeMode | null>(null);
  const [composeMailboxId, setComposeMailboxId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
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
    ? mailboxes.find((mailbox) => mailbox.id === selected.mailboxId)
    : undefined;
  const newComposeMailbox =
    mailboxes.find((mailbox) => mailbox.id === composeMailboxId) ??
    smtpMailboxes.find((mailbox) => mailbox.id === activeMailbox.id) ??
    smtpMailboxes[0] ??
    activeMailbox;
  const composeMailbox = composeMode === "compose" ? newComposeMailbox : selectedMailbox;
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
  const canComposeNew = Boolean(
    !inboxWriteDisabled &&
      !lead.doNotContact &&
      (workspace.isDemo || smtpMailboxes.length > 0 || isEmailAccountConfigured(activeMailbox)),
  );

  const syncConversationLists = React.useCallback(
    async (force: boolean) => {
      if (workspace.isDemo || !emailServerHydrated) return;
      const eligible = mailboxes.filter(isImapInboxConfigured);
      const syncKey = eligible.map((mailbox) => mailbox.id).sort().join("|");
      if (!force && initialSyncKeyRef.current === syncKey) return;
      if (!force) initialSyncKeyRef.current = syncKey;

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
                    ? "Mailbox check timed out — try Refresh or open Inbox."
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
    },
    [
      emailServerHydrated,
      mailViewAsUid,
      mailboxes,
      reconcileInboundHeadFromSync,
      reconcileSentHeadFromSync,
      workspace.currentUserId,
      workspace.isDemo,
    ],
  );

  React.useEffect(() => {
    void Promise.resolve().then(() => syncConversationLists(false));
  }, [syncConversationLists]);

  React.useEffect(() => {
    if (!selected || !selectedMailbox || workspace.isDemo) return;
    const loadId = ++bodyLoadIdRef.current;
    const inboundUids = selected.messages
      .filter(
        (row): row is Extract<LeadEmailMessage, { direction: "inbound" }> =>
          row.direction === "inbound" && row.message.bodySynced === false,
      )
      .map((row) => row.message.uid);
    const sentUids = selected.messages
      .filter(
        (row): row is Extract<LeadEmailMessage, { direction: "sent" }> =>
          row.direction === "sent" && row.message.bodySynced === false && row.message.uid != null,
      )
      .map((row) => row.message.uid!);
    if (inboundUids.length === 0 && sentUids.length === 0) {
      void Promise.resolve().then(() => {
        if (bodyLoadIdRef.current === loadId) setLoadingBodies(false);
      });
      return;
    }

    let cancelled = false;
    const fetchBodies = async (folder: "inbox" | "sent", uids: number[]) => {
      if (uids.length === 0) return;
      const forUid = resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: selectedMailbox.dataOwnerUid,
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
          mailboxId: selectedMailbox.id,
          folder,
          uids,
          imap: {
            host: selectedMailbox.imap.host,
            port: selectedMailbox.imap.port,
            secure: selectedMailbox.imap.secure,
            user: selectedMailbox.imap.user,
            pass: selectedMailbox.imap.password,
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
      if (folder === "inbox") mergeInboundBodies(selectedMailbox.id, data.updates);
      else mergeSentBodies(selectedMailbox.id, data.updates);
    };

    void Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadingBodies(true);
        return Promise.all([fetchBodies("inbox", inboundUids), fetchBodies("sent", sentUids)]);
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
    mailViewAsUid,
    mergeInboundBodies,
    mergeSentBodies,
    selected,
    selectedMailbox,
    workspace.currentUserId,
    workspace.isDemo,
  ]);

  function resetComposer() {
    setComposeMode(null);
    setComposeMailboxId("");
    setTo("");
    setCc("");
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

  function openNewCompose() {
    if (lead.doNotContact) {
      toast.error("This lead is marked do not contact.");
      return;
    }
    if (inboxWriteDisabled) {
      toast.error("Compose is disabled while viewing another member’s mailbox.");
      return;
    }
    const mailbox = smtpMailboxes[0]
      ? (smtpMailboxes.find((item) => item.id === activeMailbox.id) ?? smtpMailboxes[0])
      : activeMailbox;
    if (!workspace.isDemo && !isEmailAccountConfigured(mailbox)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }
    setSelectedId(null);
    setComposeMailboxId(mailbox.id);
    setTo(contactEmail?.trim() || "");
    setCc("");
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
                  : contactEmail || extractReplyAddress(source.to),
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
    return {
      to: toResult.addresses.join(", "),
      cc: ccResult?.addresses.join(", "),
    };
  }

  function recordSentMessage(input: {
    mailboxId: string;
    from: string;
    to: string;
    cc?: string;
    body: string;
    messageId?: string;
  }) {
    const id = addSent({
      mailboxId: input.mailboxId,
      from: input.from,
      to: input.to,
      cc: input.cc,
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
          body: outboundBody,
        });
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
        body: outboundBody,
        messageId: data.messageId,
      });
      if (draftId) useEmailAccountStore.getState().deleteDraft(draftId);
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
    if (mode === "improve" && !body.trim()) {
      toast.error("Write a message first, then improvise with AI.");
      return;
    }
    setAiBusy(true);
    try {
      const response = await fetch("/api/ai/email-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...(mode === "reply"
            ? { thread: body.trim() || subject }
            : { draft: body.trim(), subject: subject.trim() || undefined }),
          leadContext: JSON.stringify({
            id: lead.id,
            stage: lead.stage,
            company: lead.companyName,
            contact: lead.contactName,
            channel: lead.channel,
          }),
          leadId: lead.id,
          channel: lead.channel,
          profileId: lead.profileId,
          campaignId: lead.campaignId,
          tone: "professional",
          goal: mode === "reply" ? "follow up" : "Polish and improve clarity while keeping my intent and facts",
        }),
      });
      const data = (await response.json()) as { body?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not generate reply");
      setBody(data.body ?? "");
      toast.success(mode === "reply" ? "Draft generated, review before sending" : "Message improved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network error");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
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
                Messages linked in Inbox or matching {contactEmail || "the lead’s email"} appear here.
              </p>
              {syncingLists ? (
                <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking mailbox for matches…
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
                  className="group flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              {contactEmail ? ` Prefilled for ${contactEmail}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="shrink-0 space-y-3 border-b px-5 py-3">
            {smtpMailboxes.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <Select
                  value={composeMailbox?.id}
                  onValueChange={(value) => {
                    if (value) setComposeMailboxId(value);
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
                {selectedMailbox?.label || selectedMailbox?.emailAddress || "Mailbox"}
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
                  return (
                    <article key={row.key} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/15 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {row.direction === "inbound" ? senderLabel(row.message.from) : `You → ${row.message.to}`}
                          </p>
                          <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
                            From {row.message.from} · To {row.message.to}
                            {row.message.cc ? ` · Cc ${row.message.cc}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={row.direction === "inbound" ? "secondary" : "outline"} className="text-[10px]">
                            {row.direction === "inbound" ? "Received" : "Sent"}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{fmtRelative(date)}</span>
                        </div>
                      </div>
                      <MailReaderBody content={content} className="p-4" />
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
                    to={to}
                    onToChange={setTo}
                    cc={cc}
                    onCcChange={setCc}
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
