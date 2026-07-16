"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailComposeForm } from "@/components/inbox/email-compose-form";
import {
  MailReaderDialog,
  MailZoomButton,
  mailReaderContentFromInbound,
  mailReaderContentFromSent,
  MailReadingZoomActions,
} from "@/components/inbox/mail-reader-dialog";
import {
  MailLabelChips,
  MailLabelsSidebarSection,
} from "@/components/inbox/mail-labels-sidebar";
import { MailLabelPicker } from "@/components/inbox/mail-label-picker";
import {
  MailFlagIcon,
  MailFlagPicker,
  MailFlagsSidebarSection,
} from "@/components/inbox/mail-flag-picker";
import {
  collectMessageMetaKeysFromRow,
  countMessagesWithLabel,
  labelIdsForRow,
  messageMetaKeysForInbound,
  rowHasMailLabel,
} from "@/lib/email/mail-labels";
import {
  MAIL_FLAG_IDS,
  countFlaggedMessages,
  countMessagesWithFlag,
  flagIdForRow,
  mailFlagById,
  rowHasMailFlag,
  type MailFlagId,
} from "@/lib/email/mail-flags";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { format } from "date-fns";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isEmailAccountConfigured,
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import type {
  EmailMailboxSettings,
  MailDraft,
  MailInbound,
  MailInboundAttachment,
  MailSent,
  ScheduledEmail,
} from "@/lib/email-account-types";
import {
  groupInboundIntoThreads,
  type MailThread,
} from "@/lib/email/thread-inbound";
import type { Contact, Lead } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  MailOpen,
  Loader2,
  PenLine,
  RefreshCw,
  Reply,
  ReplyAll,
  Forward,
  Trash2,
  ArchiveRestore,
  Search,
  ChevronDown,
  ChevronRight,
  Paperclip,
  X,
  Ban,
  ExternalLink,
} from "lucide-react";
import {
  collectBlockedUidsFromInbound,
  extractSenderDomain,
  normalizeBlockedSenderDomain,
} from "@/lib/email/blocked-sender-domains";
import { extractUnsubscribeUrl } from "@/lib/email/mail-unsubscribe";
import {
  filterInboxBatchAndTrashBlocked,
  trashBlockedUidsInCachedInbox,
} from "@/lib/email/trash-blocked-inbox-uids";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { appendMailDataOwnerParam, resolveMailApiForUserUid } from "@/lib/email/mail-data-owner-query";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
import { INBOX_IMAP_HEAD_LIMIT } from "@/lib/email/inbox-unread-count";
import {
  MAX_COMPOSE_ATTACHMENTS,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  composeAttachmentsFromInbound,
  formatComposeFileSize,
  readFileAsBase64,
  type ComposeAttachment,
} from "@/lib/email/compose-attachments";
import {
  extractReplyAddress,
  forwardedBody,
  forwardSubject,
  replyAllRecipientLine,
  replyContextForMessage,
  replyQuotedBody,
  replyRecipientAddress,
  replySubject,
  withMailboxSignature,
} from "@/lib/email/reply-compose";
import {
  fallbackOwnerPickerLabel,
  workspaceMemberPickerLabel,
} from "@/lib/owner-scope";

function mailboxDisplayLabel(mb: EmailMailboxSettings): string {
  const label = mb.label?.trim();
  if (label) return label;
  const email = mb.emailAddress?.trim();
  if (email) return email;
  const name = mb.displayName?.trim();
  if (name) return name;
  return "Mailbox";
}

function normalizeInboxSearch(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Skip list shortcuts while typing in fields or editable regions. */
function shouldIgnoreMailListKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("[role='dialog'], [role='combobox'], [data-radix-popper-content-wrapper]"));
}

type MailListRow = {
  id: string;
  title: string;
  subtitle: string;
  at: string;
  row: MailDraft | MailSent | MailInbound | ScheduledEmail;
  muted?: boolean;
  thread?: MailThread;
  scheduled?: ScheduledEmail;
};

const ENTITY_MAIL_FILTER_ALL = "__all__";
const ENTITY_LEAD_LINKED = "lead:__linked__";
const ENTITY_LEAD_UNLINKED = "lead:__unlinked__";
const ENTITY_CONTACT_LINKED = "contact:__linked__";
const ENTITY_CONTACT_UNLINKED = "contact:__unlinked__";
const ENTITY_SUB_FILTER_ALL = "__sub_all__";
const READ_STATUS_FILTER_ALL = "__read_all__";
const READ_STATUS_UNREAD = "__read_unread__";
const READ_STATUS_READ = "__read_read__";
const INBOX_VIEW_SELF = "__inbox_view_self__";

type MailFilterStats = { total: number; unread: number };

const EMPTY_MAIL_FILTER_STATS: MailFilterStats = { total: 0, unread: 0 };

function isEntityMailFilterActive(filter: string): boolean {
  return filter !== ENTITY_MAIL_FILTER_ALL;
}

function entityMailFilterLabel(
  filter: string,
  leads: Lead[],
  contacts: Contact[],
): string {
  if (filter === ENTITY_MAIL_FILTER_ALL) return "All";
  if (filter === ENTITY_LEAD_LINKED) return "Matched lead";
  if (filter === ENTITY_LEAD_UNLINKED) return "No lead match";
  if (filter === ENTITY_CONTACT_LINKED) return "Matched contact";
  if (filter === ENTITY_CONTACT_UNLINKED) return "No contact match";
  if (filter.startsWith("lead:")) {
    const id = filter.slice("lead:".length);
    const l = leads.find((x) => x.id === id);
    if (!l) return "Lead";
    const name = l.contactName?.trim() || l.contactEmail || l.id;
    return l.companyName?.trim() ? `${name} · ${l.companyName.trim()}` : name;
  }
  if (filter.startsWith("contact:")) {
    const id = filter.slice("contact:".length);
    const c = contacts.find((x) => x.id === id);
    return c?.fullName?.trim() || c?.email || "Contact";
  }
  return "Filter";
}

function rowIsUnread(row: MailListRow): boolean {
  return row.thread?.hasUnread === true;
}

function rowMatchesReadStatusFilter(row: MailListRow, filter: string): boolean {
  if (filter === READ_STATUS_FILTER_ALL) return true;
  const unread = rowIsUnread(row);
  if (filter === READ_STATUS_UNREAD) return unread;
  if (filter === READ_STATUS_READ) return !unread;
  return true;
}

function readStatusFilterLabel(filter: string): string {
  if (filter === READ_STATUS_UNREAD) return "Unread";
  if (filter === READ_STATUS_READ) return "Read";
  return "All";
}

function bumpMailFilterStats(stats: MailFilterStats, row: MailListRow): MailFilterStats {
  return {
    total: stats.total + 1,
    unread: stats.unread + (rowIsUnread(row) ? 1 : 0),
  };
}

function contactEmailSet(contact: Contact): Set<string> {
  const out = new Set<string>();
  const primary = contact.email?.trim().toLowerCase();
  const personal = contact.personalEmail?.trim().toLowerCase();
  if (primary) out.add(primary);
  if (personal) out.add(personal);
  return out;
}

function rowMatchesEntityMailFilter(
  row: MailListRow,
  filter: string,
  subFilter: string,
  mailboxId: string,
  linkedLeadByMessageId: Record<string, string>,
  leads: Lead[],
  contacts: Contact[],
): boolean {
  if (filter === ENTITY_MAIL_FILTER_ALL) return true;

  const lead = resolveLeadForMailListRow(row, mailboxId, linkedLeadByMessageId, leads);
  const contact = resolveContactForMailListRow(row, contacts);

  if (filter === ENTITY_LEAD_LINKED) {
    if (lead == null) return false;
    if (subFilter !== ENTITY_SUB_FILTER_ALL) return lead.id === subFilter;
    return true;
  }
  if (filter === ENTITY_LEAD_UNLINKED) return lead == null;
  if (filter === ENTITY_CONTACT_LINKED) {
    if (contact == null) return false;
    if (subFilter !== ENTITY_SUB_FILTER_ALL) return contact.id === subFilter;
    return true;
  }
  if (filter === ENTITY_CONTACT_UNLINKED) return contact == null;
  return true;
}

function entitySubFilterLabel(
  filter: string,
  subFilter: string,
  leads: Lead[],
  contacts: Contact[],
): string | null {
  if (subFilter === ENTITY_SUB_FILTER_ALL) return null;
  if (filter === ENTITY_LEAD_LINKED) {
    const l = leads.find((x) => x.id === subFilter);
    if (!l) return null;
    const name = l.contactName?.trim() || l.contactEmail || l.id;
    return l.companyName?.trim() ? `${name} · ${l.companyName.trim()}` : name;
  }
  if (filter === ENTITY_CONTACT_LINKED) {
    const c = contacts.find((x) => x.id === subFilter);
    return c?.fullName?.trim() || c?.email || null;
  }
  return null;
}

function FilterCountBadge({
  stats,
  className,
}: {
  stats: MailFilterStats;
  className?: string;
}) {
  if (stats.total === 0 && stats.unread === 0) return null;
  return (
    <span className={cn("ml-auto flex shrink-0 items-center gap-1", className)}>
      {stats.total > 0 ? (
        <span
          className="text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          title={`${stats.total} conversation${stats.total === 1 ? "" : "s"}`}
        >
          {stats.total}
        </span>
      ) : null}
      {stats.unread > 0 ? (
        <span
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none text-white tabular-nums"
          title={`${stats.unread} unread`}
        >
          {stats.unread > 99 ? "99+" : stats.unread}
        </span>
      ) : null}
    </span>
  );
}

function mailListRowMatchesSearch(row: MailListRow, q: string): boolean {
  if (!q) return true;
  const head = `${row.title}\n${row.subtitle}`.toLowerCase();
  if (head.includes(q)) return true;
  if (row.thread) {
    for (const m of row.thread.messages) {
      const t = [m.subject, m.from, m.to, m.cc, m.preview, m.bodyText, ...(m.attachments?.map((a) => a.filename) ?? [])]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (t.includes(q)) return true;
    }
    return false;
  }
  const item = row.row;
  if ("body" in item && typeof item.body === "string" && item.body && item.body.toLowerCase().includes(q)) {
    return true;
  }
  if ("bodyText" in item && item.bodyText && item.bodyText.toLowerCase().includes(q)) {
    return true;
  }
  return false;
}

type MailFolder = "inbox" | "sent" | "drafts" | "trash" | "scheduled";
type ScheduledTab = "pending" | "done";
type ImapListFolder = "inbox" | "trash" | "sent";

/** Matches server-side IMAP list batching; older messages load via “Load more”. */
const INBOX_IMAP_PAGE_LIMIT = INBOX_IMAP_HEAD_LIMIT;

export default function InboxWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    leads,
    contacts,
    isDemo,
    addAccount,
    addContact,
    addLead,
    currentUserId,
    users,
    canViewMemberMailboxes,
    mailboxViewableUserIds,
    getOwnerDisplayName,
  } = useWorkspace();

  /** Legacy deep links from the old combined Inbox screen. */
  React.useEffect(() => {
    const feed = searchParams.get("feed");
    if (feed === "notifications") {
      router.replace("/notifications");
      return;
    }
    if (feed === "team_chat") {
      router.replace("/team-chat");
    }
  }, [searchParams, router]);

  /** Search mail list / threads. */
  const [listSearchQuery, setListSearchQuery] = React.useState("");
  const [readStatusFilter, setReadStatusFilter] = React.useState<string>(READ_STATUS_FILTER_ALL);
  const [entityMailFilter, setEntityMailFilter] = React.useState<string>(ENTITY_MAIL_FILTER_ALL);
  const [entitySubFilter, setEntitySubFilter] = React.useState<string>(ENTITY_SUB_FILTER_ALL);
  const [leadsFilterOpen, setLeadsFilterOpen] = React.useState(true);
  const [contactsFilterOpen, setContactsFilterOpen] = React.useState(true);
  const [selectedMailLabelId, setSelectedMailLabelId] = React.useState<string | null>(null);
  const [selectedMailFlagId, setSelectedMailFlagId] = React.useState<MailFlagId | null>(null);

  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const setActiveMailbox = useEmailAccountStore((s) => s.setActiveMailbox);
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const trashInboundByMailbox = useEmailAccountStore((s) => s.trashInboundByMailbox);
  const setInbound = useEmailAccountStore((s) => s.setInbound);
  const appendInbound = useEmailAccountStore((s) => s.appendInbound);
  const reconcileInboundHeadFromSync = useEmailAccountStore((s) => s.reconcileInboundHeadFromSync);
  const reconcileTrashHeadFromSync = useEmailAccountStore((s) => s.reconcileTrashHeadFromSync);
  const reconcileSentHeadFromSync = useEmailAccountStore((s) => s.reconcileSentHeadFromSync);
  const appendSentServer = useEmailAccountStore((s) => s.appendSentServer);
  const setTrashInbound = useEmailAccountStore((s) => s.setTrashInbound);
  const mergeSentBodies = useEmailAccountStore((s) => s.mergeSentBodies);
  const mergeInboundBodies = useEmailAccountStore((s) => s.mergeInboundBodies);
  const mergeTrashBodies = useEmailAccountStore((s) => s.mergeTrashBodies);
  const removeInboundByUids = useEmailAccountStore((s) => s.removeInboundByUids);
  const moveTrashUidsToInboxLocal = useEmailAccountStore((s) => s.moveTrashUidsToInboxLocal);
  const moveInboundUidsToTrashLocal = useEmailAccountStore((s) => s.moveInboundUidsToTrashLocal);
  const removeTrashByUids = useEmailAccountStore((s) => s.removeTrashByUids);
  const patchInboundSeen = useEmailAccountStore((s) => s.patchInboundSeen);
  const patchTrashSeen = useEmailAccountStore((s) => s.patchTrashSeen);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const blockedSenderDomains = useEmailAccountStore((s) => s.blockedSenderDomains);
  const addBlockedSenderDomain = useEmailAccountStore((s) => s.addBlockedSenderDomain);
  const linkMessageToLead = useEmailAccountStore((s) => s.linkMessageToLead);
  const mailLabels = useEmailAccountStore((s) => s.mailLabels);
  const labelsByMessageId = useEmailAccountStore((s) => s.labelsByMessageId);
  const createMailLabel = useEmailAccountStore((s) => s.createMailLabel);
  const deleteMailLabel = useEmailAccountStore((s) => s.deleteMailLabel);
  const toggleMessageLabel = useEmailAccountStore((s) => s.toggleMessageLabel);
  const addLabelsToMessages = useEmailAccountStore((s) => s.addLabelsToMessages);
  const removeLabelFromMessages = useEmailAccountStore((s) => s.removeLabelFromMessages);
  const flagByMessageId = useEmailAccountStore((s) => s.flagByMessageId);
  const setMessageFlag = useEmailAccountStore((s) => s.setMessageFlag);
  const toggleMessageFlag = useEmailAccountStore((s) => s.toggleMessageFlag);
  const drafts = useEmailAccountStore((s) => s.drafts);
  const sent = useEmailAccountStore((s) => s.sent);
  const upsertDraft = useEmailAccountStore((s) => s.upsertDraft);
  const deleteDraft = useEmailAccountStore((s) => s.deleteDraft);
  const addSent = useEmailAccountStore((s) => s.addSent);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const setScheduled = useEmailAccountStore((s) => s.setScheduled);
  const processDueScheduledLocal = useEmailAccountStore((s) => s.processDueScheduledLocal);
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const setMailViewAsUid = useEmailAccountStore((s) => s.setMailViewAsUid);
  const inboxWriteDisabled = useEmailAccountStore((s) => s.inboxWriteDisabled);
  const account = getActiveMailbox({ mailboxes, activeMailboxId });
  const mailApiForUid = React.useMemo(
    () =>
      resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: account.dataOwnerUid,
        selfUid: currentUserId,
      }),
    [mailViewAsUid, account.dataOwnerUid, currentUserId],
  );

  const inboxReadOnly = !isDemo && inboxWriteDisabled;

  const viewableMailboxIdSet = React.useMemo(
    () => new Set(mailboxViewableUserIds),
    [mailboxViewableUserIds],
  );
  const memberPickerUsers = React.useMemo(
    () =>
      [...users]
        .filter(
          (u) =>
            u.status === "active" &&
            u.id &&
            u.id !== currentUserId &&
            (!canViewMemberMailboxes || viewableMailboxIdSet.has(u.id)),
        )
        .sort((a, b) =>
          (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "", undefined, {
            sensitivity: "base",
          }),
        ),
    [users, currentUserId, canViewMemberMailboxes, viewableMailboxIdSet],
  );

  const leadsSortedForMailFilter = React.useMemo(
    () =>
      [...leads].sort((a, b) =>
        (a.contactName?.trim() || a.contactEmail || "").localeCompare(
          b.contactName?.trim() || b.contactEmail || "",
          undefined,
          { sensitivity: "base" },
        ),
      ),
    [leads],
  );

  const contactsSortedForMailFilter = React.useMemo(
    () =>
      [...contacts].sort((a, b) =>
        (a.fullName?.trim() || a.email || "").localeCompare(b.fullName?.trim() || b.email || "", undefined, {
          sensitivity: "base",
        }),
      ),
    [contacts],
  );

  const [mailFolder, setMailFolder] = React.useState<MailFolder>("inbox");
  const [selectedThread, setSelectedThread] = React.useState<MailThread | null>(null);
  /** Expanded message UIDs when viewing a multi-message thread. */
  const [expandedThreadUids, setExpandedThreadUids] = React.useState<Set<number>>(() => new Set());
  const [selectedMail, setSelectedMail] = React.useState<MailDraft | MailSent | MailInbound | null>(null);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeTo, setComposeTo] = React.useState("");
  const [composeCc, setComposeCc] = React.useState("");
  const [composeSubject, setComposeSubject] = React.useState("");
  const [composeBody, setComposeBody] = React.useState("");
  const [composeDraftId, setComposeDraftId] = React.useState<string | undefined>();
  const [composeInReplyTo, setComposeInReplyTo] = React.useState<string | undefined>();
  const [composeReferenceIds, setComposeReferenceIds] = React.useState<string[]>([]);
  const [composeAttachments, setComposeAttachments] = React.useState<ComposeAttachment[]>([]);
  const [aiReplyGenerating, setAiReplyGenerating] = React.useState(false);
  const [aiReplyTone] = React.useState<"professional" | "friendly" | "concise">("professional");
  const [aiReplyGoal] = React.useState("follow up");
  const [sending, setSending] = React.useState(false);
  const [composeScheduleEnabled, setComposeScheduleEnabled] = React.useState(false);
  const [composeScheduledAt, setComposeScheduledAt] = React.useState("");
  const [scheduledTab, setScheduledTab] = React.useState<ScheduledTab>("pending");
  const [scheduledLoading, setScheduledLoading] = React.useState(false);
  const [selectedScheduled, setSelectedScheduled] = React.useState<ScheduledEmail | null>(null);

  /** True only when there is no cached list yet (blocking empty state). */
  const [inboundLoading, setInboundLoading] = React.useState(false);
  const [inboundSyncing, setInboundSyncing] = React.useState(false);
  const [inboundLoadingMore, setInboundLoadingMore] = React.useState(false);
  const [trashLoading, setTrashLoading] = React.useState(false);
  const [trashSyncing, setTrashSyncing] = React.useState(false);
  const [sentLoading, setSentLoading] = React.useState(false);
  const [sentSyncing, setSentSyncing] = React.useState(false);
  const [sentLoadingMore, setSentLoadingMore] = React.useState(false);
  const [sentFetchError, setSentFetchError] = React.useState<string | null>(null);
  /** Total messages in INBOX on server (from last IMAP list); may exceed loaded rows. */
  const [imapMailboxTotal, setImapMailboxTotal] = React.useState<number | null>(null);
  const [imapTrashTotal, setImapTrashTotal] = React.useState<number | null>(null);
  const [imapSentTotal, setImapSentTotal] = React.useState<number | null>(null);
  const sentForMailbox = React.useMemo(
    () => sent.filter((m) => m.mailboxId === account.id),
    [sent, account.id],
  );
  const inbound = React.useMemo(
    () => inboundByMailbox[account.id] ?? [],
    [inboundByMailbox, account.id],
  );
  const trashInbound = React.useMemo(
    () => trashInboundByMailbox[account.id] ?? [],
    [trashInboundByMailbox, account.id],
  );
  const inboundThreads = React.useMemo(() => groupInboundIntoThreads(inbound), [inbound]);
  const trashThreads = React.useMemo(() => groupInboundIntoThreads(trashInbound), [trashInbound]);
  /** Row ids for bulk delete (inbox → trash, or permanent delete in trash). */
  const [selectedMailRowIds, setSelectedMailRowIds] = React.useState<Set<string>>(() => new Set());
  const [purgeTrashOpen, setPurgeTrashOpen] = React.useState(false);
  const [blockDomainOpen, setBlockDomainOpen] = React.useState(false);
  const [blockDomainTarget, setBlockDomainTarget] = React.useState("");
  const [mailActionLoading, setMailActionLoading] = React.useState(false);

  const blockDomainPendingStats = React.useMemo(() => {
    const domain = normalizeBlockedSenderDomain(blockDomainTarget);
    if (!domain) return { messages: 0, conversations: 0 };
    const messageUids = collectBlockedUidsFromInbound(inbound, [domain]);
    const conversations = inboundThreads.filter((t) =>
      t.messages.some((m) => extractSenderDomain(m.from) === domain),
    ).length;
    return { messages: messageUids.length, conversations };
  }, [blockDomainTarget, inbound, inboundThreads]);

  const emailFolderSupportsImapList = mailFolder === "inbox" || mailFolder === "trash";
  const canUseTrashFeatures = isDemo || isImapInboxConfigured(account);
  /** Bulk move/delete and row checkboxes require IMAP and must not run on another member’s mailbox. */
  const showImapBulkMailActions = canUseTrashFeatures && (isDemo || !inboxReadOnly);

  React.useEffect(() => {
    setImapMailboxTotal(null);
    setImapTrashTotal(null);
    setImapSentTotal(null);
  }, [account.id]);

  React.useEffect(() => {
    setSelectedThread((prev) => {
      if (!prev) return null;
      const threads = mailFolder === "trash" ? trashThreads : inboundThreads;
      return threads.find((t) => t.threadId === prev.threadId) ?? null;
    });
  }, [inboundThreads, trashThreads, mailFolder]);

  React.useEffect(() => {
    if (!selectedThread) {
      setExpandedThreadUids(new Set());
      return;
    }
    if (selectedThread.messages.length <= 1) {
      setExpandedThreadUids(new Set(selectedThread.messages.map((m) => m.uid)));
      return;
    }
    const latest = selectedThread.messages[selectedThread.messages.length - 1];
    setExpandedThreadUids(latest ? new Set([latest.uid]) : new Set());
  }, [selectedThread?.threadId, selectedThread?.messages.length]);

  const toggleThreadMessageExpanded = React.useCallback((uid: number) => {
    setExpandedThreadUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  React.useEffect(() => {
    setEntityMailFilter(ENTITY_MAIL_FILTER_ALL);
    setEntitySubFilter(ENTITY_SUB_FILTER_ALL);
  }, [activeMailboxId]);

  React.useEffect(() => {
    setEntitySubFilter(ENTITY_SUB_FILTER_ALL);
  }, [entityMailFilter]);

  React.useEffect(() => {
    setReadStatusFilter(READ_STATUS_FILTER_ALL);
    if (mailFolder === "sent" || mailFolder === "drafts" || mailFolder === "scheduled") {
      setEntityMailFilter(ENTITY_MAIL_FILTER_ALL);
      setEntitySubFilter(ENTITY_SUB_FILTER_ALL);
    }
  }, [mailFolder]);

  /** Load RFC822 bodies for older messages when a thread is opened (bulk sync only parses the newest chunk). */
  React.useEffect(() => {
    if (isDemo) return;
    if (mailFolder !== "inbox" && mailFolder !== "trash") return;
    const threadId = selectedThread?.threadId;
    if (!threadId) return;

    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) return;

    const listFolder: ImapListFolder = mailFolder === "trash" ? "trash" : "inbox";

    const resolveThread = () => {
      const st = useEmailAccountStore.getState();
      const list =
        listFolder === "trash"
          ? (st.trashInboundByMailbox[acct.id] ?? [])
          : (st.inboundByMailbox[acct.id] ?? []);
      return groupInboundIntoThreads(list).find((t) => t.threadId === threadId);
    };

    const ac = new AbortController();
    let cancelled = false;

    void (async () => {
      const CHUNK = 50;
      try {
        for (;;) {
          if (cancelled || ac.signal.aborted) return;
          const thread = resolveThread();
          if (!thread) return;
          const need = thread.messages.filter((m) => m.bodySynced === false).map((m) => m.uid);
          if (need.length === 0) return;
          const part = need.slice(0, CHUNK);
          const url = appendMailDataOwnerParam("/api/email/imap-fetch-bodies", mailApiForUid, currentUserId);
          const res = await fetch(url, {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mailboxId: acct.id,
              folder: listFolder,
              uids: part,
              imap: {
                host: acct.imap.host,
                port: acct.imap.port,
                secure: acct.imap.secure,
                user: acct.imap.user,
                pass: acct.imap.password,
              },
            }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            error?: string;
            updates?: Array<{ uid: number } & Partial<MailInbound>>;
          };
          if (!data.ok || !Array.isArray(data.updates)) {
            if (!cancelled && data.error) {
              toast.error("Couldn’t load message body", {
                description: data.error.length > 280 ? `${data.error.slice(0, 280)}…` : data.error,
              });
            }
            return;
          }
          if (listFolder === "trash") mergeTrashBodies(acct.id, data.updates);
          else mergeInboundBodies(acct.id, data.updates);
        }
      } catch {
        if (!cancelled && !ac.signal.aborted) {
          toast.error("Could not load full message text");
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    isDemo,
    mailFolder,
    selectedThread?.threadId,
    mergeInboundBodies,
    mergeTrashBodies,
    account.id,
    account.imap.host,
    account.imap.port,
    account.imap.secure,
    account.imap.user,
    account.imap.password,
    mailViewAsUid, mailApiForUid,
    currentUserId,
  ]);

  const fetchImapListFolder = React.useCallback(
    async (folder: ImapListFolder) => {
      if (isDemo) {
        if (folder === "inbox") {
          toast.message("Demo inbox", { description: "Sample threads only, no IMAP server is used." });
        }
        return;
      }
      if (!useEmailAccountStore.getState().emailServerHydrated) return;
      const acct = getActiveMailbox(useEmailAccountStore.getState());
      const mailboxId = acct.id;
      if (!isImapInboxConfigured(acct)) {
        if (folder === "inbox") setInbound(acct.id, []);
        else if (folder === "trash") setTrashInbound(acct.id, []);
        else if (folder === "sent") setSentFetchError("Configure IMAP in Settings → Email to load Sent mail.");
        return;
      }
      if (folder === "sent") setSentFetchError(null);
      const stBefore = useEmailAccountStore.getState();
      const cachedLen =
        folder === "inbox"
          ? (stBefore.inboundByMailbox[acct.id]?.length ?? 0)
          : folder === "trash"
            ? (stBefore.trashInboundByMailbox[acct.id]?.length ?? 0)
            : stBefore.sent.filter((m) => m.mailboxId === acct.id && m.uid != null).length;
      if (folder === "inbox") {
        if (cachedLen > 0) setInboundSyncing(true);
        else setInboundLoading(true);
      } else if (folder === "sent") {
        if (cachedLen > 0) setSentSyncing(true);
        else setSentLoading(true);
      } else if (cachedLen > 0) {
        setTrashSyncing(true);
      } else {
        setTrashLoading(true);
      }
      try {
        const url = appendMailDataOwnerParam("/api/email/imap-fetch", mailApiForUid, currentUserId);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mailboxId: acct.id,
            folder,
            limit: INBOX_IMAP_PAGE_LIMIT,
            offset: 0,
            imap: {
              host: acct.imap.host,
              port: acct.imap.port,
              secure: acct.imap.secure,
              user: acct.imap.user,
              pass: acct.imap.password,
            },
          }),
        });
        let data: {
          ok?: boolean;
          error?: string;
          messages?: MailInbound[];
          mailboxTotal?: number;
          mailboxPath?: string;
          skippedNoEnvelope?: number;
        };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          toast.error("Invalid response from mail server");
          if (folder === "sent") setSentFetchError("Invalid response from mail server.");
          return;
        }
        if (!res.ok || !data.ok) {
          const err = data.error ?? `Mail server error (${res.status})`;
          const label =
            folder === "inbox" ? "Couldn’t refresh mail" : folder === "sent" ? "Couldn’t load Sent" : "Couldn’t load Trash";
          toast.error(label, {
            description: err.length > 400 ? `${err.slice(0, 400)}…` : err,
          });
          if (folder === "sent") setSentFetchError(err);
          return;
        }
        const stillActive = getActiveMailbox(useEmailAccountStore.getState()).id;
        if (stillActive !== mailboxId) return;

        let rows = Array.isArray(data.messages) ? data.messages : [];
        if (folder === "inbox") {
          rows = await filterInboxBatchAndTrashBlocked({
            messages: rows,
            blockedDomains: useEmailAccountStore.getState().blockedSenderDomains,
            isDemo,
            inboxReadOnly,
            mailViewAsUid,
            currentUserId,
          });
        }
        const total =
          typeof data.mailboxTotal === "number" && Number.isFinite(data.mailboxTotal) ? data.mailboxTotal : null;
        if (folder === "inbox") {
          reconcileInboundHeadFromSync(acct.id, rows);
          setImapMailboxTotal(total);
        } else if (folder === "sent") {
          reconcileSentHeadFromSync(mailboxId, rows);
          setImapSentTotal(total);
          if (rows.length === 0) {
            const serverTotal = total ?? 0;
            const skipped = data.skippedNoEnvelope ?? 0;
            if (serverTotal > 0 && skipped > 0) {
              const err = `Found ${serverTotal} messages in Sent but could not read them. Try Refresh mail.`;
              setSentFetchError(err);
              toast.error("Couldn’t load Sent messages", { description: err });
            } else if (serverTotal === 0) {
              setSentFetchError(null);
            }
          } else {
            setSentFetchError(null);
          }
        } else {
          reconcileTrashHeadFromSync(acct.id, rows);
          setImapTrashTotal(total);
        }
      } catch {
        toast.error("Could not reach the server");
        if (folder === "sent") setSentFetchError("Could not reach the server. Check your connection and try Refresh mail.");
      } finally {
        if (folder === "inbox") {
          setInboundLoading(false);
          setInboundSyncing(false);
        } else if (folder === "sent") {
          setSentLoading(false);
          setSentSyncing(false);
        } else {
          setTrashLoading(false);
          setTrashSyncing(false);
        }
      }
    },
    [
      isDemo,
      inboxReadOnly,
      setInbound,
      setTrashInbound,
      reconcileInboundHeadFromSync,
      reconcileTrashHeadFromSync,
      reconcileSentHeadFromSync,
      mailViewAsUid, mailApiForUid,
      currentUserId,
      emailServerHydrated,
    ],
  );

  const fetchInboundMail = React.useCallback(() => fetchImapListFolder("inbox"), [fetchImapListFolder]);
  const fetchTrashMail = React.useCallback(() => fetchImapListFolder("trash"), [fetchImapListFolder]);
  const fetchSentMail = React.useCallback(() => fetchImapListFolder("sent"), [fetchImapListFolder]);

  const loadMoreSentMail = React.useCallback(async () => {
    if (isDemo || sentLoadingMore) return;
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) return;
    const offset = sentForMailbox.filter((m) => m.uid != null).length;
    if (imapSentTotal != null && offset >= imapSentTotal) return;

    setSentLoadingMore(true);
    try {
      const url = appendMailDataOwnerParam("/api/email/imap-fetch", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: acct.id,
          folder: "sent",
          limit: INBOX_IMAP_PAGE_LIMIT,
          offset,
          imap: {
            host: acct.imap.host,
            port: acct.imap.port,
            secure: acct.imap.secure,
            user: acct.imap.user,
            pass: acct.imap.password,
          },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        messages?: MailInbound[];
        mailboxTotal?: number;
      };
      if (!data.ok) {
        const err = data.error ?? "Unknown error from the mail server.";
        toast.error("Couldn’t load older sent mail", {
          description: err.length > 400 ? `${err.slice(0, 400)}…` : err,
        });
        return;
      }
      const batch = Array.isArray(data.messages) ? data.messages : [];
      appendSentServer(acct.id, batch);
      const total =
        typeof data.mailboxTotal === "number" && Number.isFinite(data.mailboxTotal) ? data.mailboxTotal : null;
      if (total != null) setImapSentTotal(total);
      if (batch.length === 0) {
        toast.message("No additional sent messages loaded", {
          description: "Try refreshing Sent.",
        });
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSentLoadingMore(false);
    }
  }, [
    isDemo,
    sentLoadingMore,
    sentForMailbox,
    imapSentTotal,
    appendSentServer,
    mailViewAsUid, mailApiForUid,
    currentUserId,
  ]);

  const loadMoreInboundMail = React.useCallback(async () => {
    if (isDemo || inboundLoadingMore) return;
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) return;
    const offset = useEmailAccountStore.getState().inboundByMailbox[acct.id]?.length ?? 0;
    if (imapMailboxTotal != null && offset >= imapMailboxTotal) return;

    setInboundLoadingMore(true);
    try {
      const url = appendMailDataOwnerParam("/api/email/imap-fetch", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: acct.id,
          folder: "inbox",
          limit: INBOX_IMAP_PAGE_LIMIT,
          offset,
          imap: {
            host: acct.imap.host,
            port: acct.imap.port,
            secure: acct.imap.secure,
            user: acct.imap.user,
            pass: acct.imap.password,
          },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        messages?: MailInbound[];
        mailboxTotal?: number;
      };
      if (!data.ok) {
        const err = data.error ?? "Unknown error from the mail server.";
        toast.error("Couldn’t load older mail", {
          description: err.length > 400 ? `${err.slice(0, 400)}…` : err,
        });
        return;
      }
      let batch = Array.isArray(data.messages) ? data.messages : [];
      batch = await filterInboxBatchAndTrashBlocked({
        messages: batch,
        blockedDomains: useEmailAccountStore.getState().blockedSenderDomains,
        isDemo,
        inboxReadOnly,
        mailViewAsUid,
        currentUserId,
      });
      appendInbound(acct.id, batch);
      const total =
        typeof data.mailboxTotal === "number" && Number.isFinite(data.mailboxTotal) ? data.mailboxTotal : null;
      if (total != null) setImapMailboxTotal(total);
      if (batch.length === 0) {
        toast.message("No additional messages loaded", {
          description: "Try refreshing the inbox.",
        });
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setInboundLoadingMore(false);
    }
  }, [
    isDemo,
    inboxReadOnly,
    inboundLoadingMore,
    imapMailboxTotal,
    appendInbound,
    mailViewAsUid, mailApiForUid,
    currentUserId,
  ]);

  /** Sweep cached INBOX for newly blocked domains (e.g. after block or settings sync). */
  React.useEffect(() => {
    if (inboxReadOnly) return;
    if (!emailServerHydrated || mailFolder !== "inbox") return;
    if (blockedSenderDomains.length === 0) return;
    if (!isImapInboxConfigured(account) && !isDemo) return;

    let cancelled = false;
    void (async () => {
      const moved = await trashBlockedUidsInCachedInbox({
        mailboxId: account.id,
        messages: inbound,
        blockedDomains: blockedSenderDomains,
        isDemo,
        inboxReadOnly,
        mailViewAsUid,
        currentUserId,
      });
      if (cancelled || moved === 0) return;
      toast.message(
        moved === 1 ? "1 blocked message moved to Trash" : `${moved} blocked messages moved to Trash`,
        { description: "Open Trash to review. Nothing is deleted until you delete forever." },
      );
      if (!isDemo) void fetchTrashMail();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    blockedSenderDomains,
    inbound,
    isDemo,
    inboxReadOnly,
    emailServerHydrated,
    mailFolder,
    account.id,
    mailViewAsUid, mailApiForUid,
    currentUserId,
    fetchTrashMail,
  ]);

  /** Load INBOX, Sent, or Trash from IMAP when that folder is opened. */
  React.useEffect(() => {
    if (mailFolder !== "inbox" && mailFolder !== "trash" && mailFolder !== "sent") return;
    if (isDemo) return;
    if (!emailServerHydrated) return;

    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) {
      setInbound(acct.id, []);
      setTrashInbound(acct.id, []);
      return;
    }
    if (mailFolder === "inbox") void fetchImapListFolder("inbox");
    else if (mailFolder === "sent") void fetchImapListFolder("sent");
    else void fetchImapListFolder("trash");
  }, [
    mailFolder,
    isDemo,
    emailServerHydrated,
    activeMailboxId,
    account.id,
    account.imap.host,
    account.imap.port,
    account.imap.secure,
    account.imap.user,
    fetchImapListFolder,
    setInbound,
    setTrashInbound,
    mailViewAsUid, mailApiForUid,
    currentUserId,
  ]);

  /** Load full body when opening a Sent message that only has headers from bulk sync. */
  React.useEffect(() => {
    if (isDemo) return;
    if (mailFolder !== "sent") return;
    if (!selectedMail || !("sentAt" in selectedMail)) return;
    const row = selectedMail as MailSent;
    if (row.uid == null || row.bodySynced !== false) return;

    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) return;

    const ac = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const url = appendMailDataOwnerParam("/api/email/imap-fetch-bodies", mailApiForUid, currentUserId);
        const res = await fetch(url, {
          method: "POST",
          signal: ac.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mailboxId: acct.id,
            folder: "sent",
            uids: [row.uid],
            imap: {
              host: acct.imap.host,
              port: acct.imap.port,
              secure: acct.imap.secure,
              user: acct.imap.user,
              pass: acct.imap.password,
            },
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          updates?: Array<{ uid: number; bodyText?: string; bodyHtml?: string; preview?: string; bodySynced?: boolean }>;
        };
        if (!data.ok || !Array.isArray(data.updates) || data.updates.length === 0) {
          if (!cancelled && data.error) {
            toast.error("Couldn’t load message body", { description: data.error });
          }
          return;
        }
        mergeSentBodies(acct.id, data.updates);
        const patch = data.updates[0];
        if (patch && selectedMail?.id === row.id) {
          setSelectedMail({
            ...row,
            body: patch.bodyText ?? row.body,
            bodyHtml: patch.bodyHtml ?? row.bodyHtml,
            preview: patch.preview ?? row.preview,
            bodySynced: true,
          });
        }
      } catch {
        if (!cancelled) toast.error("Could not load full message text");
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    isDemo,
    mailFolder,
    selectedMail,
    mergeSentBodies,
    account.id,
    account.imap.host,
    account.imap.port,
    account.imap.secure,
    account.imap.user,
    account.imap.password,
    mailViewAsUid, mailApiForUid,
    currentUserId,
  ]);

  function defaultScheduleDatetimeLocal(): string {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${da}T${h}:${mi}`;
  }

  function openCompose(preset?: Partial<MailDraft>) {
    if (inboxReadOnly) {
      toast.error("Compose is disabled while viewing another member’s mailbox.");
      return;
    }
    setComposeTo(preset?.to ?? "");
    setComposeCc(preset?.cc?.trim() ? preset.cc.trim() : "");
    setComposeSubject(preset?.subject ?? "");
    setComposeBody(preset?.body ?? (account.signature ? `\n\n${account.signature}` : ""));
    setComposeDraftId(preset?.id);
    setComposeInReplyTo(preset?.inReplyTo);
    setComposeReferenceIds(preset?.referenceIds ?? []);
    setComposeAttachments(preset?.attachments ?? []);
    setComposeScheduleEnabled(false);
    setComposeScheduledAt(defaultScheduleDatetimeLocal());
    setComposeOpen(true);
  }

  const fetchScheduledEmails = React.useCallback(async () => {
    if (isDemo) return;
    setScheduledLoading(true);
    try {
      const url = appendMailDataOwnerParam("/api/email/scheduled", mailApiForUid, currentUserId);
      const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; items?: ScheduledEmail[] };
      if (res.ok && data.ok && Array.isArray(data.items)) {
        setScheduled(data.items);
      }
    } catch {
      /* keep cached list */
    } finally {
      setScheduledLoading(false);
    }
  }, [isDemo, mailViewAsUid, mailApiForUid, currentUserId, setScheduled]);

  React.useEffect(() => {
    if (isDemo || !emailServerHydrated) return;
    void fetchScheduledEmails();
  }, [isDemo, emailServerHydrated, fetchScheduledEmails, mailViewAsUid, mailApiForUid]);

  React.useEffect(() => {
    if (!isDemo) return;
    processDueScheduledLocal();
    const id = window.setInterval(() => processDueScheduledLocal(), 15_000);
    return () => window.clearInterval(id);
  }, [isDemo, processDueScheduledLocal, scheduled]);

  async function addComposeAttachments(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    const remaining = MAX_COMPOSE_ATTACHMENTS - composeAttachments.length;
    if (remaining <= 0) {
      toast.error(`You can attach up to ${MAX_COMPOSE_ATTACHMENTS} files.`);
      return;
    }

    const toAdd = list.slice(0, remaining);
    if (list.length > remaining) {
      toast.message(`Only ${remaining} more file${remaining === 1 ? "" : "s"} can be added.`);
    }

    const next: ComposeAttachment[] = [];
    for (const file of toAdd) {
      if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large (max ${formatComposeFileSize(MAX_COMPOSE_ATTACHMENT_BYTES)}).`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(file);
        if (!contentBase64) {
          toast.error(`Could not read ${file.name}.`);
          continue;
        }
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

    if (next.length > 0) {
      setComposeAttachments((prev) => [
        ...prev,
        ...next.slice(0, Math.max(0, MAX_COMPOSE_ATTACHMENTS - prev.length)),
      ]);
    }
  }

  function removeComposeAttachment(id: string) {
    setComposeAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSend() {
    const toParsed = normalizeRecipientList(composeTo, "To");
    if (!toParsed.ok) {
      toast.error(toParsed.error);
      return;
    }
    const ccParsed = composeCc.trim() ? normalizeRecipientList(composeCc, "Cc") : null;
    if (ccParsed && !ccParsed.ok) {
      toast.error(ccParsed.error);
      return;
    }
    const toLine = toParsed.addresses.join(", ");
    const ccLine = ccParsed?.addresses.join(", ");
    if (!account.emailAddress.trim()) {
      toast.error("Set your From email in Settings → Email before sending.");
      return;
    }
    if (isDemo) {
      setSending(true);
      try {
        addSent({
          mailboxId: account.id,
          from: account.emailAddress.trim() || "demo@nova.local",
          to: toLine,
          cc: ccLine || undefined,
          subject: composeSubject.trim() || "(no subject)",
          body: composeBody,
          inReplyTo: composeInReplyTo,
          referenceIds: composeReferenceIds,
        });
        if (composeDraftId) deleteDraft(composeDraftId);
        toast.success("Message saved to Sent (demo)", {
          description:
            composeAttachments.length > 0
              ? "SMTP is not used in demo mode. Attachments are not stored in demo sent mail."
              : "SMTP is not used in demo mode.",
        });
        setComposeAttachments([]);
        setComposeOpen(false);
        setMailFolder("sent");
        setSelectedMail(null);
        setSelectedThread(null);
      } finally {
        setSending(false);
      }
      return;
    }
    if (!isEmailAccountConfigured(account)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }
    if (inboxReadOnly) {
      toast.error("Sending is disabled while viewing another member’s mailbox.");
      return;
    }
    setSending(true);
    try {
      const text = composeBody;
      const html = composeBody.split("\n").map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`).join("");
      const url = appendMailDataOwnerParam("/api/email/send", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: account.id,
          leadId: selectedLead?.id,
          from: account.emailAddress,
          displayName: account.displayName,
          replyTo: account.replyTo,
          to: toLine,
          cc: ccLine || undefined,
          subject: composeSubject.trim(),
          text,
          html,
          inReplyTo: composeInReplyTo,
          referenceIds: composeReferenceIds,
          attachments:
            composeAttachments.length > 0
              ? composeAttachments.map((a) => ({
                  filename: a.filename,
                  mimeType: a.mimeType,
                  contentBase64: a.contentBase64,
                }))
              : undefined,
          smtp: {
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            user: account.smtp.user,
            pass: account.smtp.password,
          },
          imap: isImapInboxConfigured(account)
            ? {
                host: account.imap.host,
                port: account.imap.port,
                secure: account.imap.secure,
                user: account.imap.user,
                pass: account.imap.password,
              }
            : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sentSavedToMailbox?: boolean;
        messageId?: string;
      };
      if (!data.ok) {
        const err = data.error ?? "Send failed";
        toast.error("Couldn't send email", {
          description: err.length > 320 ? `${err.slice(0, 320)}…` : err,
        });
        return;
      }
      if (composeDraftId) deleteDraft(composeDraftId);
      toast.success("Message sent", {
        description:
          data.sentSavedToMailbox === false && isImapInboxConfigured(account)
            ? "Delivered, but could not save a copy to your mail server Sent folder. Refresh Sent to check."
            : undefined,
      });
      setComposeAttachments([]);
      setComposeOpen(false);
      setMailFolder("sent");
      setSelectedMail(null);
      setSelectedThread(null);
      if (isImapInboxConfigured(account)) {
        await fetchImapListFolder("sent");
      } else {
        addSent({
          mailboxId: account.id,
          from: account.emailAddress,
          to: toLine,
          cc: ccLine || undefined,
          subject: composeSubject.trim(),
          body: composeBody,
          messageId: data.messageId,
          inReplyTo: composeInReplyTo,
          referenceIds: composeReferenceIds,
        });
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSending(false);
    }
  }

  async function handleScheduleSend() {
    const toParsed = normalizeRecipientList(composeTo, "To");
    if (!toParsed.ok) {
      toast.error(toParsed.error);
      return;
    }
    const ccParsed = composeCc.trim() ? normalizeRecipientList(composeCc, "Cc") : null;
    if (ccParsed && !ccParsed.ok) {
      toast.error(ccParsed.error);
      return;
    }
    const toLine = toParsed.addresses.join(", ");
    const ccLine = ccParsed?.addresses.join(", ");
    if (!composeScheduledAt.trim()) {
      toast.error("Pick a date and time");
      return;
    }
    const scheduledDate = new Date(composeScheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      toast.error("Invalid schedule time");
      return;
    }
    if (scheduledDate.getTime() < Date.now() + 60_000) {
      toast.error("Schedule time must be at least 1 minute in the future");
      return;
    }

    if (isDemo) {
      setSending(true);
      try {
        addScheduled({
          mailboxId: account.id,
          from: account.emailAddress.trim() || "demo@nova.local",
          to: toLine,
          cc: ccLine || undefined,
          subject: composeSubject.trim() || "(no subject)",
          body: composeBody,
          text: composeBody,
          scheduledAt: scheduledDate.toISOString(),
          inReplyTo: composeInReplyTo,
          referenceIds: composeReferenceIds,
        });
        if (composeDraftId) deleteDraft(composeDraftId);
        toast.success("Email scheduled (demo)", {
          description: `Will move to Sent after ${format(scheduledDate, "MMM d, h:mm a")}.`,
        });
        setComposeAttachments([]);
        setComposeOpen(false);
        setMailFolder("scheduled");
        setScheduledTab("pending");
        setSelectedScheduled(null);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!isEmailAccountConfigured(account)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }
    if (inboxReadOnly) {
      toast.error("Scheduling is disabled while viewing another member’s mailbox.");
      return;
    }

    setSending(true);
    try {
      const text = composeBody;
      const html = composeBody.split("\n").map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`).join("");
      const url = appendMailDataOwnerParam("/api/email/scheduled", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: account.id,
          leadId: selectedLead?.id,
          from: account.emailAddress,
          displayName: account.displayName,
          replyTo: account.replyTo,
          to: toLine,
          cc: ccLine || undefined,
          subject: composeSubject.trim(),
          text,
          html,
          scheduledAt: scheduledDate.toISOString(),
          inReplyTo: composeInReplyTo,
          referenceIds: composeReferenceIds,
          attachments:
            composeAttachments.length > 0
              ? composeAttachments.map((a) => ({
                  filename: a.filename,
                  mimeType: a.mimeType,
                  contentBase64: a.contentBase64,
                }))
              : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "Could not schedule email");
        return;
      }
      if (composeDraftId) deleteDraft(composeDraftId);
      toast.success("Email scheduled", {
        description: `Sending ${format(scheduledDate, "MMM d, yyyy 'at' h:mm a")}`,
      });
      setComposeAttachments([]);
      setComposeOpen(false);
      setMailFolder("scheduled");
      setScheduledTab("pending");
      setSelectedScheduled(null);
      void fetchScheduledEmails();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSending(false);
    }
  }

  async function cancelScheduledEmail(id: string) {
    if (isDemo) {
      cancelScheduled(id);
      setSelectedScheduled(null);
      toast.success("Scheduled email cancelled");
      return;
    }
    try {
      const url = appendMailDataOwnerParam(
        `/api/email/scheduled/${encodeURIComponent(id)}`, mailApiForUid,
        currentUserId,
      );
      const res = await fetch(url, { method: "DELETE", credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "Could not cancel");
        return;
      }
      setSelectedScheduled(null);
      toast.success("Scheduled email cancelled");
      void fetchScheduledEmails();
    } catch {
      toast.error("Could not reach the server");
    }
  }

  function saveDraft() {
    const id = upsertDraft({
      id: composeDraftId,
      mailboxId: account.id,
      to: composeTo,
      cc: composeCc.trim() || undefined,
      subject: composeSubject,
      body: composeBody,
      attachments: composeAttachments,
      inReplyTo: composeInReplyTo,
      referenceIds: composeReferenceIds,
    });
    setComposeDraftId(id);
    toast.success("Draft saved for this session");
  }

  const toggleRowSelected = React.useCallback((rowId: string, checked: boolean) => {
    setSelectedMailRowIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  /** Anchor row index for Shift+click / Shift+Space range selection (Apple Mail style). */
  const bulkSelectAnchorIndexRef = React.useRef<number | null>(null);

  const clearMailRowSelection = React.useCallback(() => {
    bulkSelectAnchorIndexRef.current = null;
    setSelectedMailRowIds(new Set());
  }, []);

  const collectUidsFromMailRows = React.useCallback(
    (rowIds: Set<string>, rows: MailListRow[]) => {
      const uidSet = new Set<number>();
      for (const row of rows) {
        if (!rowIds.has(row.id)) continue;
        if (row.thread) for (const m of row.thread.messages) uidSet.add(m.uid);
        else if ("uid" in row.row && typeof row.row.uid === "number") uidSet.add(row.row.uid);
      }
      return [...uidSet];
    },
    [],
  );

  const collectUnreadUidsFromMailRows = React.useCallback(
    (rowIds: Set<string>, rows: MailListRow[]) => {
      const uidSet = new Set<number>();
      for (const row of rows) {
        if (!rowIds.has(row.id)) continue;
        if (row.thread) {
          for (const m of row.thread.messages) {
            if (!m.seen) uidSet.add(m.uid);
          }
        } else if (
          "uid" in row.row &&
          typeof row.row.uid === "number" &&
          "seen" in row.row &&
          !row.row.seen
        ) {
          uidSet.add(row.row.uid);
        }
      }
      return [...uidSet];
    },
    [],
  );

  const collectSeenUidsFromMailRows = React.useCallback(
    (rowIds: Set<string>, rows: MailListRow[]) => {
      const uidSet = new Set<number>();
      for (const row of rows) {
        if (!rowIds.has(row.id)) continue;
        if (row.thread) {
          for (const m of row.thread.messages) {
            if (m.seen) uidSet.add(m.uid);
          }
        } else if (
          "uid" in row.row &&
          typeof row.row.uid === "number" &&
          "seen" in row.row &&
          row.row.seen
        ) {
          uidSet.add(row.row.uid);
        }
      }
      return [...uidSet];
    },
    [],
  );

  async function moveUidsToServerTrash(uids: number[]) {
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    const CHUNK = 60;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const part = uids.slice(i, i + CHUNK);
      const url = appendMailDataOwnerParam("/api/email/imap-mutate", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "moveInboxToTrash",
          mailboxId: acct.id,
          uids: part,
          imap: {
            host: acct.imap.host,
            port: acct.imap.port,
            secure: acct.imap.secure,
            user: acct.imap.user,
            pass: acct.imap.password,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        throw new Error(data.error ?? "Move to Trash failed");
      }
    }
  }

  async function moveUidsFromTrashToServerInbox(uids: number[]) {
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    const CHUNK = 60;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const part = uids.slice(i, i + CHUNK);
      const url = appendMailDataOwnerParam("/api/email/imap-mutate", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "moveTrashToInbox",
          mailboxId: acct.id,
          uids: part,
          imap: {
            host: acct.imap.host,
            port: acct.imap.port,
            secure: acct.imap.secure,
            user: acct.imap.user,
            pass: acct.imap.password,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        throw new Error(data.error ?? "Restore to Inbox failed");
      }
    }
  }

  async function permanentlyDeleteUidsOnServer(uids: number[]) {
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    const CHUNK = 60;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const part = uids.slice(i, i + CHUNK);
      const url = appendMailDataOwnerParam("/api/email/imap-mutate", mailApiForUid, currentUserId);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "permanentDeleteTrash",
          mailboxId: acct.id,
          uids: part,
          imap: {
            host: acct.imap.host,
            port: acct.imap.port,
            secure: acct.imap.secure,
            user: acct.imap.user,
            pass: acct.imap.password,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        throw new Error(data.error ?? "Permanent delete failed");
      }
    }
  }

  function openBlockDomainDialog(domain: string) {
    const key = normalizeBlockedSenderDomain(domain);
    if (!key) {
      toast.error("Could not read a domain from this sender.");
      return;
    }
    setBlockDomainTarget(key);
    setBlockDomainOpen(true);
  }

  async function confirmBlockSenderDomain() {
    const domain = normalizeBlockedSenderDomain(blockDomainTarget);
    if (!domain) {
      setBlockDomainOpen(false);
      return;
    }
    setMailActionLoading(true);
    try {
      addBlockedSenderDomain(domain);
      const nextBlocked = [...new Set([...blockedSenderDomains, domain])];
      const uids = collectBlockedUidsFromInbound(inbound, nextBlocked);
      if (uids.length > 0) {
        if (isDemo) {
          moveInboundUidsToTrashLocal(account.id, uids);
        } else {
          await moveUidsToServerTrash(uids);
          removeInboundByUids(account.id, uids);
        }
      }
      setBlockDomainOpen(false);
      setSelectedThread(null);
      setSelectedMail(null);
      clearMailRowSelection();
      toast.success(`Blocked ${domain}`, {
        description:
          uids.length > 0
            ? `${uids.length} message${uids.length === 1 ? "" : "s"} moved to Trash. Future mail from this domain will go to Trash automatically.`
            : "Future mail from this domain will be moved to Trash automatically.",
      });
      if (!isDemo) {
        void fetchImapListFolder("inbox");
        void fetchImapListFolder("trash");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Could not block domain", {
        description: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
      });
    } finally {
      setMailActionLoading(false);
    }
  }

  async function moveInboxUidsToTrashNow(uids: number[]) {
    if (uids.length === 0) return;
    setMailActionLoading(true);
    try {
      if (isDemo) {
        moveInboundUidsToTrashLocal(account.id, uids);
        toast.success(
          uids.length === 1 ? "Message moved to Trash" : `${uids.length} messages moved to Trash`,
        );
      } else {
        await moveUidsToServerTrash(uids);
        removeInboundByUids(account.id, uids);
        toast.success(
          uids.length === 1
            ? "Moved to Trash on the server"
            : `${uids.length} conversations moved to Trash`,
        );
        void fetchImapListFolder("inbox");
        void fetchImapListFolder("trash");
      }
      clearMailRowSelection();
      setSelectedThread(null);
      setSelectedMail(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Could not move to Trash", {
        description: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
      });
      if (!isDemo) void fetchImapListFolder("inbox");
    } finally {
      setMailActionLoading(false);
    }
  }

  async function restoreTrashUidsToInboxNow(uids: number[]) {
    if (uids.length === 0) return;
    setMailActionLoading(true);
    try {
      if (isDemo) {
        moveTrashUidsToInboxLocal(account.id, uids);
        toast.success(
          uids.length === 1 ? "Message restored to Inbox" : `${uids.length} messages restored to Inbox`,
        );
      } else {
        await moveUidsFromTrashToServerInbox(uids);
        moveTrashUidsToInboxLocal(account.id, uids);
        toast.success(
          uids.length === 1
            ? "Restored to Inbox on the server"
            : `${uids.length} conversations restored to Inbox`,
        );
        void fetchImapListFolder("inbox");
        void fetchImapListFolder("trash");
      }
      clearMailRowSelection();
      setSelectedThread(null);
      setSelectedMail(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Could not restore to Inbox", {
        description: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
      });
      if (!isDemo) void fetchImapListFolder("trash");
    } finally {
      setMailActionLoading(false);
    }
  }

  async function permanentlyDeleteTrashUidsNow(uids: number[]) {
    if (uids.length === 0) {
      setPurgeTrashOpen(false);
      return;
    }
    setMailActionLoading(true);
    try {
      if (isDemo) {
        removeTrashByUids(account.id, uids);
        toast.success("Permanently deleted");
      } else {
        await permanentlyDeleteUidsOnServer(uids);
        removeTrashByUids(account.id, uids);
        toast.success("Permanently deleted from the server");
        void fetchImapListFolder("trash");
        void fetchImapListFolder("inbox");
      }
      clearMailRowSelection();
      setPurgeTrashOpen(false);
      setSelectedThread(null);
      setSelectedMail(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Could not delete", { description: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg });
      if (!isDemo) void fetchImapListFolder("trash");
    } finally {
      setMailActionLoading(false);
    }
  }

  const mailListRows: MailListRow[] = React.useMemo(() => {
    if (mailFolder === "inbox") {
      return inboundThreads.map((t) => ({
        id: `${account.id}:thread:${t.threadId}`,
        title: t.conversationSubject,
        subtitle:
          t.messages.length > 1
            ? `${t.latest.from} · ${t.messages.length} messages`
            : t.latest.from,
        at: t.latest.date,
        row: t.latest,
        muted: !t.hasUnread,
        thread: t,
      }));
    }
    if (mailFolder === "trash") {
      return trashThreads.map((t) => ({
        id: `${account.id}:trash-thread:${t.threadId}`,
        title: t.conversationSubject,
        subtitle:
          t.messages.length > 1
            ? `${t.latest.from} · ${t.messages.length} messages`
            : t.latest.from,
        at: t.latest.date,
        row: t.latest,
        muted: true,
        thread: t,
      }));
    }
    if (mailFolder === "sent") {
      return sentForMailbox.map((m) => ({
        id: m.id,
        title: m.subject || "(no subject)",
        subtitle: m.to,
        at: m.sentAt,
        row: m,
      }));
    }
    if (mailFolder === "drafts") {
      return drafts.filter((m) => m.mailboxId === account.id).map((m) => ({
        id: m.id,
        title: m.subject || "(no subject)",
        subtitle: m.to || "No recipient",
        at: m.updatedAt,
        row: m,
      }));
    }
    if (mailFolder === "scheduled") {
      return scheduled
        .filter((m) => m.mailboxId === account.id)
        .filter((m) =>
          scheduledTab === "pending"
            ? m.status === "pending" || m.status === "processing"
            : m.status !== "pending" && m.status !== "processing",
        )
        .map((m) => ({
          id: m.id,
          title: m.subject || "(no subject)",
          subtitle:
            scheduledTab === "pending"
              ? `${m.to} · sends ${format(new Date(m.scheduledAt), "MMM d, h:mm a")}`
              : `${m.to} · ${m.status}${m.error ? ", failed" : ""}`,
          at: scheduledTab === "pending" ? m.scheduledAt : m.sentAt ?? m.scheduledAt,
          row: m,
          scheduled: m,
          muted: m.status === "cancelled",
        }));
    }
    return [];
  }, [mailFolder, sentForMailbox, drafts, scheduled, scheduledTab, inboundThreads, trashThreads, account.id]);

  const scheduledPendingCount = React.useMemo(
    () =>
      scheduled.filter(
        (m) =>
          m.mailboxId === account.id &&
          (m.status === "pending" || m.status === "processing"),
      ).length,
    [scheduled, account.id],
  );

  const inboxMailListRows = React.useMemo((): MailListRow[] => {
    return inboundThreads.map((t) => ({
      id: `${account.id}:thread:${t.threadId}`,
      title: t.conversationSubject,
      subtitle:
        t.messages.length > 1
          ? `${t.latest.from} · ${t.messages.length} messages`
          : t.latest.from,
      at: t.latest.date,
      row: t.latest,
      muted: !t.hasUnread,
      thread: t,
    }));
  }, [inboundThreads, account.id]);

  const inboxMailFilterStats = React.useMemo(() => {
    const all = { ...EMPTY_MAIL_FILTER_STATS };
    const leadLinked = { ...EMPTY_MAIL_FILTER_STATS };
    const leadUnlinked = { ...EMPTY_MAIL_FILTER_STATS };
    const contactLinked = { ...EMPTY_MAIL_FILTER_STATS };
    const contactUnlinked = { ...EMPTY_MAIL_FILTER_STATS };
    const byLeadId = new Map<string, MailFilterStats>();
    const byContactId = new Map<string, MailFilterStats>();

    for (const row of inboxMailListRows) {
      all.total += 1;
      if (rowIsUnread(row)) all.unread += 1;

      const lead = resolveLeadForMailListRow(row, account.id, linkedLeadByMessageId, leads);
      const contact = resolveContactForMailListRow(row, contacts);

      if (lead) {
        leadLinked.total += 1;
        if (rowIsUnread(row)) leadLinked.unread += 1;
        const prev = byLeadId.get(lead.id) ?? { ...EMPTY_MAIL_FILTER_STATS };
        byLeadId.set(lead.id, bumpMailFilterStats(prev, row));
      } else {
        leadUnlinked.total += 1;
        if (rowIsUnread(row)) leadUnlinked.unread += 1;
      }

      if (contact) {
        contactLinked.total += 1;
        if (rowIsUnread(row)) contactLinked.unread += 1;
        const prev = byContactId.get(contact.id) ?? { ...EMPTY_MAIL_FILTER_STATS };
        byContactId.set(contact.id, bumpMailFilterStats(prev, row));
      } else {
        contactUnlinked.total += 1;
        if (rowIsUnread(row)) contactUnlinked.unread += 1;
      }
    }

    const leadsWithMail = leadsSortedForMailFilter
      .filter((l) => byLeadId.has(l.id))
      .map((l) => ({ lead: l, stats: byLeadId.get(l.id)! }))
      .sort((a, b) => b.stats.unread - a.stats.unread || b.stats.total - a.stats.total);

    const contactsWithMail = contactsSortedForMailFilter
      .filter((c) => byContactId.has(c.id))
      .map((c) => ({ contact: c, stats: byContactId.get(c.id)! }))
      .sort((a, b) => b.stats.unread - a.stats.unread || b.stats.total - a.stats.total);

    return {
      all,
      leadLinked,
      leadUnlinked,
      contactLinked,
      contactUnlinked,
      leadsWithMail,
      contactsWithMail,
      leadStats: (id: string) => byLeadId.get(id) ?? EMPTY_MAIL_FILTER_STATS,
      contactStats: (id: string) => byContactId.get(id) ?? EMPTY_MAIL_FILTER_STATS,
    };
  }, [
    inboxMailListRows,
    account.id,
    linkedLeadByMessageId,
    leads,
    contacts,
    leadsSortedForMailFilter,
    contactsSortedForMailFilter,
  ]);

  const readFilterScopeRows = React.useMemo(() => {
    if (mailFolder !== "inbox" && mailFolder !== "trash") return [] as MailListRow[];
    let rows = mailListRows;
    if (entityMailFilter !== ENTITY_MAIL_FILTER_ALL) {
      rows = rows.filter((row) =>
        rowMatchesEntityMailFilter(
          row,
          entityMailFilter,
          entitySubFilter,
          account.id,
          linkedLeadByMessageId,
          leads,
          contacts,
        ),
      );
    }
    return rows;
  }, [
    mailFolder,
    mailListRows,
    entityMailFilter,
    entitySubFilter,
    account.id,
    linkedLeadByMessageId,
    leads,
    contacts,
  ]);

  const readFilterStats = React.useMemo(() => {
    let unread = 0;
    for (const row of readFilterScopeRows) {
      if (rowIsUnread(row)) unread += 1;
    }
    const total = readFilterScopeRows.length;
    return { total, unread, read: total - unread };
  }, [readFilterScopeRows]);

  const visibleMailRows = React.useMemo(() => {
    const q = normalizeInboxSearch(listSearchQuery);
    let rows = mailListRows;
    if (entityMailFilter !== ENTITY_MAIL_FILTER_ALL) {
      rows = rows.filter((row) =>
        rowMatchesEntityMailFilter(
          row,
          entityMailFilter,
          entitySubFilter,
          account.id,
          linkedLeadByMessageId,
          leads,
          contacts,
        ),
      );
    }
    if (mailFolder === "inbox" || mailFolder === "trash") {
      rows = rows.filter((row) => rowMatchesReadStatusFilter(row, readStatusFilter));
    }
    if (selectedMailLabelId) {
      rows = rows.filter((row) =>
        rowHasMailLabel(row, account.id, mailFolder, labelsByMessageId, selectedMailLabelId),
      );
    }
    if (selectedMailFlagId) {
      rows = rows.filter((row) =>
        rowHasMailFlag(row, account.id, mailFolder, flagByMessageId, selectedMailFlagId),
      );
    }
    return rows.filter((row) => mailListRowMatchesSearch(row, q));
  }, [
    mailListRows,
    mailFolder,
    listSearchQuery,
    readStatusFilter,
    entityMailFilter,
    entitySubFilter,
    account.id,
    linkedLeadByMessageId,
    leads,
    contacts,
    selectedMailLabelId,
    labelsByMessageId,
    selectedMailFlagId,
    flagByMessageId,
  ]);

  const selectMailRowRange = React.useCallback((anchorIdx: number, endIdx: number) => {
    const lo = Math.min(anchorIdx, endIdx);
    const hi = Math.max(anchorIdx, endIdx);
    setSelectedMailRowIds(new Set(visibleMailRows.slice(lo, hi + 1).map((r) => r.id)));
  }, [visibleMailRows]);

  const handleMailRowBulkSelect = React.useCallback(
    (rowId: string, rowIndex: number, shiftKey: boolean) => {
      if (shiftKey && bulkSelectAnchorIndexRef.current !== null) {
        selectMailRowRange(bulkSelectAnchorIndexRef.current, rowIndex);
        return;
      }
      toggleRowSelected(rowId, !selectedMailRowIds.has(rowId));
      bulkSelectAnchorIndexRef.current = rowIndex;
    },
    [selectMailRowRange, selectedMailRowIds, toggleRowSelected],
  );

  const collectMessageKeysFromMailRows = React.useCallback(
    (rowIds: Set<string>, rows: MailListRow[]) => {
      const keys = new Set<string>();
      for (const row of rows) {
        if (!rowIds.has(row.id)) continue;
        for (const key of collectMessageMetaKeysFromRow(row, account.id, mailFolder)) {
          keys.add(key);
        }
      }
      return [...keys];
    },
    [account.id, mailFolder],
  );

  const mailLabelCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const label of mailLabels) {
      counts[label.id] = countMessagesWithLabel(
        inboxMailListRows,
        account.id,
        "inbox",
        labelsByMessageId,
        label.id,
      );
    }
    return counts;
  }, [mailLabels, inboxMailListRows, account.id, labelsByMessageId]);

  const selectedMailLabel = React.useMemo(
    () => mailLabels.find((l) => l.id === selectedMailLabelId) ?? null,
    [mailLabels, selectedMailLabelId],
  );

  const openThreadLabelIds = React.useMemo(() => {
    if (!selectedThread) return [] as string[];
    const folder = mailFolder === "trash" ? "trash" : "inbox";
    const keys = selectedThread.messages.flatMap((m) =>
      messageMetaKeysForInbound(account.id, m, folder),
    );
    const ids = new Set<string>();
    for (const key of keys) {
      for (const id of labelsByMessageId[key] ?? []) ids.add(id);
    }
    return [...ids];
  }, [selectedThread, account.id, mailFolder, labelsByMessageId]);

  const handleCreateMailLabel = React.useCallback(
    (name: string, color: string) => {
      const id = createMailLabel(name, color);
      if (!id) return;
      toast.success(`Label “${name.trim()}” created`);
      const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
      if (keys.length > 0) addLabelsToMessages(keys, [id]);
    },
    [
      createMailLabel,
      collectMessageKeysFromMailRows,
      selectedMailRowIds,
      visibleMailRows,
      addLabelsToMessages,
    ],
  );

  const handleToggleLabelOnSelection = React.useCallback(
    (labelId: string) => {
      const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
      if (keys.length === 0) {
        toast.message("Select messages first, or open a conversation to label it.");
        return;
      }
      toggleMessageLabel(keys, labelId);
    },
    [collectMessageKeysFromMailRows, selectedMailRowIds, visibleMailRows, toggleMessageLabel],
  );

  const handleToggleLabelOnOpenThread = React.useCallback(
    (labelId: string) => {
      if (!selectedThread) return;
      const folder = mailFolder === "trash" ? "trash" : "inbox";
      const keys = selectedThread.messages.flatMap((m) =>
        messageMetaKeysForInbound(account.id, m, folder),
      );
      toggleMessageLabel(keys, labelId);
    },
    [selectedThread, mailFolder, account.id, toggleMessageLabel],
  );

  const handleRemoveLabelFromSelection = React.useCallback(
    (labelId: string) => {
      const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
      if (keys.length === 0) {
        toast.message("Select messages first, or open a conversation.");
        return;
      }
      removeLabelFromMessages(keys, labelId);
      const name = mailLabels.find((l) => l.id === labelId)?.name ?? "label";
      toast.success(`Removed from “${name}”`);
    },
    [
      collectMessageKeysFromMailRows,
      selectedMailRowIds,
      visibleMailRows,
      removeLabelFromMessages,
      mailLabels,
    ],
  );

  const handleRemoveLabelFromOpenThread = React.useCallback(
    (labelId: string) => {
      if (!selectedThread) return;
      const folder = mailFolder === "trash" ? "trash" : "inbox";
      const keys = selectedThread.messages.flatMap((m) =>
        messageMetaKeysForInbound(account.id, m, folder),
      );
      removeLabelFromMessages(keys, labelId);
      const name = mailLabels.find((l) => l.id === labelId)?.name ?? "label";
      toast.success(`Removed from “${name}”`);
    },
    [selectedThread, mailFolder, account.id, removeLabelFromMessages, mailLabels],
  );

  const handleRemoveFromActiveLabelFilter = React.useCallback(() => {
    if (!selectedMailLabelId) return;
    if (selectedMailRowIds.size > 0) {
      handleRemoveLabelFromSelection(selectedMailLabelId);
      return;
    }
    if (selectedThread) {
      handleRemoveLabelFromOpenThread(selectedMailLabelId);
      return;
    }
    toast.message("Select messages or open a conversation to remove from this label.");
  }, [
    selectedMailLabelId,
    selectedMailRowIds.size,
    selectedThread,
    handleRemoveLabelFromSelection,
    handleRemoveLabelFromOpenThread,
  ]);

  const handleRemoveLabelFromMailRow = React.useCallback(
    (row: MailListRow, labelId: string) => {
      const keys = collectMessageMetaKeysFromRow(row, account.id, mailFolder);
      if (keys.length === 0) return;
      removeLabelFromMessages(keys, labelId);
    },
    [account.id, mailFolder, removeLabelFromMessages],
  );

  const handleDeleteMailLabel = React.useCallback(
    (labelId: string) => {
      const name = mailLabels.find((l) => l.id === labelId)?.name ?? "Label";
      deleteMailLabel(labelId);
      if (selectedMailLabelId === labelId) setSelectedMailLabelId(null);
      toast.success(`Deleted “${name}”`);
    },
    [deleteMailLabel, mailLabels, selectedMailLabelId],
  );

  const selectedRowsLabelIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const row of visibleMailRows) {
      if (!selectedMailRowIds.has(row.id)) continue;
      for (const id of labelIdsForRow(row, account.id, mailFolder, labelsByMessageId)) {
        ids.add(id);
      }
    }
    return [...ids];
  }, [visibleMailRows, selectedMailRowIds, account.id, mailFolder, labelsByMessageId]);

  const mailFlagCounts = React.useMemo(() => {
    const counts = Object.fromEntries(MAIL_FLAG_IDS.map((id) => [id, 0])) as Record<
      MailFlagId,
      number
    >;
    for (const id of MAIL_FLAG_IDS) {
      counts[id] = countMessagesWithFlag(
        inboxMailListRows,
        account.id,
        "inbox",
        flagByMessageId,
        id,
      );
    }
    return counts;
  }, [inboxMailListRows, account.id, flagByMessageId]);

  const flaggedMailTotal = React.useMemo(
    () => countFlaggedMessages(inboxMailListRows, account.id, "inbox", flagByMessageId),
    [inboxMailListRows, account.id, flagByMessageId],
  );

  const openThreadFlagId = React.useMemo(() => {
    if (!selectedThread) return null;
    const folder = mailFolder === "trash" ? "trash" : "inbox";
    const latest = selectedThread.latest;
    const keys = messageMetaKeysForInbound(account.id, latest, folder);
    for (let i = keys.length - 1; i >= 0; i--) {
      const hit = flagByMessageId[keys[i]!];
      if (hit) return hit;
    }
    return null;
  }, [selectedThread, account.id, mailFolder, flagByMessageId]);

  const selectedRowsFlagId = React.useMemo((): MailFlagId | null => {
    const flags = new Set<MailFlagId>();
    for (const row of visibleMailRows) {
      if (!selectedMailRowIds.has(row.id)) continue;
      const f = flagIdForRow(row, account.id, mailFolder, flagByMessageId);
      if (f) flags.add(f);
    }
    return flags.size === 1 ? [...flags][0]! : null;
  }, [visibleMailRows, selectedMailRowIds, account.id, mailFolder, flagByMessageId]);

  const handleSetFlagOnSelection = React.useCallback(
    (flagId: MailFlagId) => {
      const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
      if (keys.length === 0) {
        toast.message("Select messages first, or open a conversation.");
        return;
      }
      setMessageFlag(keys, flagId);
      const name = mailFlagById(flagId)?.name ?? flagId;
      toast.success(`Flagged ${name}`);
    },
    [collectMessageKeysFromMailRows, selectedMailRowIds, visibleMailRows, setMessageFlag],
  );

  const handleClearFlagOnSelection = React.useCallback(() => {
    const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
    if (keys.length === 0) {
      toast.message("Select messages first, or open a conversation.");
      return;
    }
    setMessageFlag(keys, null);
    toast.success("Flag cleared");
  }, [collectMessageKeysFromMailRows, selectedMailRowIds, visibleMailRows, setMessageFlag]);

  const handleToggleFlagOnSelection = React.useCallback(() => {
    const keys = collectMessageKeysFromMailRows(selectedMailRowIds, visibleMailRows);
    if (keys.length === 0) {
      toast.message("Select messages first, or open a conversation.");
      return;
    }
    toggleMessageFlag(keys);
  }, [collectMessageKeysFromMailRows, selectedMailRowIds, visibleMailRows, toggleMessageFlag]);

  const handleSetFlagOnOpenThread = React.useCallback(
    (flagId: MailFlagId) => {
      if (!selectedThread) return;
      const folder = mailFolder === "trash" ? "trash" : "inbox";
      const keys = selectedThread.messages.flatMap((m) =>
        messageMetaKeysForInbound(account.id, m, folder),
      );
      setMessageFlag(keys, flagId);
    },
    [selectedThread, mailFolder, account.id, setMessageFlag],
  );

  const handleClearFlagOnOpenThread = React.useCallback(() => {
    if (!selectedThread) return;
    const folder = mailFolder === "trash" ? "trash" : "inbox";
    const keys = selectedThread.messages.flatMap((m) =>
      messageMetaKeysForInbound(account.id, m, folder),
    );
    setMessageFlag(keys, null);
  }, [selectedThread, mailFolder, account.id, setMessageFlag]);

  const handleToggleFlagOnOpenThread = React.useCallback(() => {
    if (!selectedThread) return;
    const folder = mailFolder === "trash" ? "trash" : "inbox";
    const keys = selectedThread.messages.flatMap((m) =>
      messageMetaKeysForInbound(account.id, m, folder),
    );
    toggleMessageFlag(keys);
  }, [selectedThread, mailFolder, account.id, toggleMessageFlag]);

  const showEntitySubFilter =
    entityMailFilter === ENTITY_LEAD_LINKED || entityMailFilter === ENTITY_CONTACT_LINKED;

  const entitySubFilterOptions = React.useMemo(() => {
    if (entityMailFilter === ENTITY_LEAD_LINKED) {
      return inboxMailFilterStats.leadsWithMail.map(({ lead: l, stats }) => {
        const name = l.contactName?.trim() || l.contactEmail || l.id;
        const label = l.companyName?.trim() ? `${name} · ${l.companyName.trim()}` : name;
        return { id: l.id, label, stats };
      });
    }
    if (entityMailFilter === ENTITY_CONTACT_LINKED) {
      return inboxMailFilterStats.contactsWithMail.map(({ contact: c, stats }) => ({
        id: c.id,
        label: c.fullName?.trim() || c.email || c.id,
        stats,
      }));
    }
    return [];
  }, [entityMailFilter, inboxMailFilterStats.leadsWithMail, inboxMailFilterStats.contactsWithMail]);

  const mailSearchActive = normalizeInboxSearch(listSearchQuery).length > 0;
  const entitySubFilterActive = entitySubFilter !== ENTITY_SUB_FILTER_ALL;
  const entityMailFilterActive =
    isEntityMailFilterActive(entityMailFilter) || entitySubFilterActive;
  const readStatusFilterActive =
    (mailFolder === "inbox" || mailFolder === "trash") &&
    readStatusFilter !== READ_STATUS_FILTER_ALL;
  const mailLabelFilterActive = selectedMailLabelId != null;
  const mailFlagFilterActive = selectedMailFlagId != null;
  const listFilterActive =
    mailSearchActive ||
    entityMailFilterActive ||
    readStatusFilterActive ||
    mailLabelFilterActive ||
    mailFlagFilterActive;
  const activeEntityFilterLabel = React.useMemo(() => {
    const base = entityMailFilterLabel(entityMailFilter, leads, contacts);
    const sub = entitySubFilterLabel(entityMailFilter, entitySubFilter, leads, contacts);
    return sub ? `${base} · ${sub}` : base;
  }, [entityMailFilter, entitySubFilter, leads, contacts]);
  const activeListFilterSummary = React.useMemo(() => {
    const parts: string[] = [];
    if (readStatusFilterActive) parts.push(readStatusFilterLabel(readStatusFilter));
    if (entityMailFilterActive) parts.push(activeEntityFilterLabel);
    if (mailLabelFilterActive && selectedMailLabel) parts.push(`Label “${selectedMailLabel.name}”`);
    if (mailFlagFilterActive && selectedMailFlagId) {
      const flagName = mailFlagById(selectedMailFlagId)?.name ?? selectedMailFlagId;
      parts.push(`Flag ${flagName}`);
    }
    if (mailSearchActive) parts.push(`Search “${listSearchQuery.trim()}”`);
    return parts.join(" · ");
  }, [
    readStatusFilterActive,
    readStatusFilter,
    entityMailFilterActive,
    activeEntityFilterLabel,
    mailLabelFilterActive,
    selectedMailLabel,
    mailFlagFilterActive,
    selectedMailFlagId,
    mailSearchActive,
    listSearchQuery,
  ]);

  function clearAllListFilters() {
    setReadStatusFilter(READ_STATUS_FILTER_ALL);
    setEntityMailFilter(ENTITY_MAIL_FILTER_ALL);
    setEntitySubFilter(ENTITY_SUB_FILTER_ALL);
    setListSearchQuery("");
    setSelectedMailLabelId(null);
    setSelectedMailFlagId(null);
  }

  const selectAllVisibleMailRows = React.useCallback(() => {
    setSelectedMailRowIds(new Set(visibleMailRows.map((r) => r.id)));
    bulkSelectAnchorIndexRef.current = visibleMailRows.length > 0 ? 0 : null;
  }, [visibleMailRows]);

  async function handleMoveInboxSelectionToTrash() {
    const uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
    await moveInboxUidsToTrashNow(uids);
  }

  async function handleRestoreTrashSelection() {
    const uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
    await restoreTrashUidsToInboxNow(uids);
  }

  const selectedUnreadUids = React.useMemo(
    () => collectUnreadUidsFromMailRows(selectedMailRowIds, visibleMailRows),
    [collectUnreadUidsFromMailRows, selectedMailRowIds, visibleMailRows],
  );

  const selectedSeenUids = React.useMemo(
    () => collectSeenUidsFromMailRows(selectedMailRowIds, visibleMailRows),
    [collectSeenUidsFromMailRows, selectedMailRowIds, visibleMailRows],
  );

  const applySeenToUids = React.useCallback(
    async (uids: number[], seen: boolean) => {
      if (uids.length === 0) return;
      if (mailFolder !== "inbox" && mailFolder !== "trash") return;

      const folder = mailFolder === "trash" ? "trash" : "inbox";
      const patchLocal = folder === "trash" ? patchTrashSeen : patchInboundSeen;
      patchLocal(account.id, uids, seen);

      if (isDemo || inboxReadOnly) return;

      const acct = getActiveMailbox(useEmailAccountStore.getState());
      const action = seen ? "markSeen" : "markUnseen";
      const CHUNK = 60;
      try {
        for (let i = 0; i < uids.length; i += CHUNK) {
          const part = uids.slice(i, i + CHUNK);
          const url = appendMailDataOwnerParam("/api/email/imap-mutate", mailApiForUid, currentUserId);
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              folder,
              mailboxId: acct.id,
              uids: part,
              imap: {
                host: acct.imap.host,
                port: acct.imap.port,
                secure: acct.imap.secure,
                user: acct.imap.user,
                pass: acct.imap.password,
              },
            }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!data.ok) {
            throw new Error(data.error ?? (seen ? "Mark as read failed" : "Mark as unread failed"));
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast.error(seen ? "Could not mark as read" : "Could not mark as unread", {
          description: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg,
        });
        void fetchImapListFolder(folder);
      }
    },
    [
      mailFolder,
      account.id,
      patchInboundSeen,
      patchTrashSeen,
      isDemo,
      inboxReadOnly,
      mailViewAsUid, mailApiForUid,
      currentUserId,
      fetchImapListFolder,
    ],
  );

  const markThreadAsRead = React.useCallback(
    (thread: MailThread) => {
      const uids = thread.messages.filter((m) => !m.seen).map((m) => m.uid);
      void applySeenToUids(uids, true);
    },
    [applySeenToUids],
  );

  const markThreadAsUnread = React.useCallback(
    (thread: MailThread) => {
      const uids = thread.messages.filter((m) => m.seen).map((m) => m.uid);
      void applySeenToUids(uids, false);
    },
    [applySeenToUids],
  );

  async function handleMarkSelectionAsRead() {
    if (selectedUnreadUids.length === 0) return;
    setMailActionLoading(true);
    try {
      await applySeenToUids(selectedUnreadUids, true);
    } finally {
      setMailActionLoading(false);
    }
  }

  async function handleMarkSelectionAsUnread() {
    if (selectedSeenUids.length === 0) return;
    setMailActionLoading(true);
    try {
      await applySeenToUids(selectedSeenUids, false);
    } finally {
      setMailActionLoading(false);
    }
  }

  /** Mark read once when a conversation is opened — not when the user marks it unread again. */
  const autoReadConversationRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (mailFolder !== "inbox" && mailFolder !== "trash") {
      autoReadConversationRef.current = null;
      return;
    }
    /** Unread tab: user marks read manually (Reply / trash / Mark as read) — no open-on-select auto-read. */
    if (readStatusFilter === READ_STATUS_UNREAD) {
      return;
    }
    if (selectedThread) {
      const key = `thread:${selectedThread.threadId}`;
      if (autoReadConversationRef.current === key) return;
      autoReadConversationRef.current = key;
      if (selectedThread.hasUnread) markThreadAsRead(selectedThread);
      return;
    }
    if (selectedMail && "uid" in selectedMail && typeof selectedMail.uid === "number") {
      const key = `uid:${selectedMail.uid}`;
      if (autoReadConversationRef.current === key) return;
      autoReadConversationRef.current = key;
      if ("seen" in selectedMail && !selectedMail.seen) void applySeenToUids([selectedMail.uid], true);
      return;
    }
    autoReadConversationRef.current = null;
  }, [
    mailFolder,
    readStatusFilter,
    selectedThread?.threadId,
    selectedMail && "uid" in selectedMail && typeof selectedMail.uid === "number"
      ? selectedMail.uid
      : null,
    markThreadAsRead,
    applySeenToUids,
  ]);

  React.useEffect(() => {
    const unreadFilterActive = readStatusFilter === READ_STATUS_UNREAD;

    if (visibleMailRows.length === 0) {
      if (unreadFilterActive && (selectedThread || selectedMail)) {
        return;
      }
      if (listFilterActive) {
        setSelectedThread(null);
        setSelectedMail(null);
      }
      return;
    }
    if (selectedThread) {
      const ok = visibleMailRows.some((r) => r.thread?.threadId === selectedThread.threadId);
      if (ok) return;
      if (unreadFilterActive) return;
      const pick = visibleMailRows[0]!;
      if (pick.thread) {
        setSelectedThread(pick.thread);
        setSelectedMail(null);
        setSelectedScheduled(null);
      } else if (pick.scheduled) {
        setSelectedThread(null);
        setSelectedMail(null);
        setSelectedScheduled(pick.scheduled);
      } else {
        setSelectedThread(null);
        setSelectedMail(pick.row as MailDraft | MailSent | MailInbound);
        setSelectedScheduled(null);
      }
      return;
    }
    if (selectedMail) {
      const ok = visibleMailRows.some((r) => !r.thread && !r.scheduled && r.row.id === selectedMail.id);
      if (ok) return;
      if (unreadFilterActive) return;
      const pick = visibleMailRows[0]!;
      if (pick.thread) {
        setSelectedThread(pick.thread);
        setSelectedMail(null);
        setSelectedScheduled(null);
      } else if (pick.scheduled) {
        setSelectedThread(null);
        setSelectedMail(null);
        setSelectedScheduled(pick.scheduled);
      } else {
        setSelectedThread(null);
        setSelectedMail(pick.row as MailDraft | MailSent | MailInbound);
        setSelectedScheduled(null);
      }
    }
  }, [visibleMailRows, selectedThread, selectedMail, selectedScheduled, listFilterActive, readStatusFilter]);

  const mailRowElByIdRef = React.useRef<Map<string, HTMLElement>>(new Map());

  const selectVisibleMailRow = React.useCallback((row: MailListRow) => {
    if (row.thread) {
      setSelectedThread(row.thread);
      setSelectedMail(null);
      setSelectedScheduled(null);
    } else if (row.scheduled) {
      setSelectedThread(null);
      setSelectedMail(null);
      setSelectedScheduled(row.scheduled);
    } else {
      setSelectedThread(null);
      setSelectedMail(row.row as MailDraft | MailSent | MailInbound);
      setSelectedScheduled(null);
    }
  }, []);

  const resolveVisibleMailRowIndex = React.useCallback(() => {
    if (selectedThread) {
      const i = visibleMailRows.findIndex((r) => r.thread?.threadId === selectedThread.threadId);
      if (i >= 0) return i;
    }
    if (selectedMail && selectedThread == null) {
      const i = visibleMailRows.findIndex((r) => !r.thread && !r.scheduled && r.row.id === selectedMail.id);
      if (i >= 0) return i;
    }
    if (selectedScheduled) {
      const i = visibleMailRows.findIndex((r) => r.scheduled?.id === selectedScheduled.id);
      if (i >= 0) return i;
    }
    return visibleMailRows.length > 0 ? 0 : -1;
  }, [visibleMailRows, selectedThread, selectedMail, selectedScheduled]);

  const scrollMailRowIntoView = React.useCallback((rowId: string) => {
    mailRowElByIdRef.current.get(rowId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (composeOpen || purgeTrashOpen || blockDomainOpen) return;
      if (shouldIgnoreMailListKeyboardTarget(e.target)) return;
      if (visibleMailRows.length === 0) return;
      if (mailFolder !== "inbox" && mailFolder !== "trash" && mailFolder !== "sent" && mailFolder !== "drafts" && mailFolder !== "scheduled") {
        return;
      }

      let idx = resolveVisibleMailRowIndex();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = idx < 0 ? 0 : Math.min(idx + 1, visibleMailRows.length - 1);
        const row = visibleMailRows[idx];
        if (row) {
          selectVisibleMailRow(row);
          scrollMailRowIntoView(row.id);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = idx < 0 ? 0 : Math.max(idx - 1, 0);
        const row = visibleMailRows[idx];
        if (row) {
          selectVisibleMailRow(row);
          scrollMailRowIntoView(row.id);
        }
        return;
      }

      if (e.key === " " || e.code === "Space") {
        if (!showImapBulkMailActions) return;
        const t = e.target;
        if (t instanceof HTMLButtonElement && !t.closest("[data-mail-list-row]")) return;
        e.preventDefault();
        if (idx < 0) idx = 0;
        const row = visibleMailRows[idx];
        if (!row) return;
        handleMailRowBulkSelect(row.id, idx, e.shiftKey);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (mailActionLoading || !showImapBulkMailActions) return;

        if (mailFolder === "inbox") {
          e.preventDefault();
          let uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
          if (uids.length === 0 && idx >= 0) {
            const row = visibleMailRows[idx];
            if (row) uids = collectUidsFromMailRows(new Set([row.id]), visibleMailRows);
          }
          if (uids.length > 0) void moveInboxUidsToTrashNow(uids);
          return;
        }

        if (mailFolder === "trash") {
          e.preventDefault();
          let uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
          if (uids.length === 0 && idx >= 0) {
            const row = visibleMailRows[idx];
            if (row) uids = collectUidsFromMailRows(new Set([row.id]), visibleMailRows);
          }
          if (uids.length > 0) setPurgeTrashOpen(true);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    blockDomainOpen,
    collectUidsFromMailRows,
    composeOpen,
    mailActionLoading,
    mailFolder,
    purgeTrashOpen,
    resolveVisibleMailRowIndex,
    scrollMailRowIntoView,
    selectVisibleMailRow,
    handleMailRowBulkSelect,
    selectedMailRowIds,
    showImapBulkMailActions,
    visibleMailRows,
  ]);

  const pageActions = (
    <div className="flex gap-2 flex-wrap">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={
          (mailFolder === "inbox" && (inboundLoading || inboundLoadingMore)) ||
          (mailFolder === "trash" && trashLoading) ||
          (mailFolder === "sent" && sentLoading) ||
          (!isDemo &&
            !isImapInboxConfigured(account) &&
            (mailFolder === "inbox" || mailFolder === "trash" || mailFolder === "sent"))
        }
        onClick={() => {
          if (mailFolder === "trash") void fetchTrashMail();
          else if (mailFolder === "sent") void fetchSentMail();
          else void fetchInboundMail();
        }}
        title={
          isDemo
            ? "Sample inbox, refresh shows this reminder"
            : isImapInboxConfigured(account)
              ? mailFolder === "trash"
                ? "Reload Trash from the server"
                : mailFolder === "sent"
                  ? "Reload Sent from the server"
                  : "Reload messages from the server"
              : "Configure IMAP in Email settings to refresh"
        }
      >
        {((mailFolder === "inbox" && (inboundLoading || inboundSyncing)) ||
          (mailFolder === "trash" && (trashLoading || trashSyncing)) ||
          (mailFolder === "sent" && (sentLoading || sentSyncing))) ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Refresh mail
      </Button>
      <Button size="sm" onClick={() => openCompose()} disabled={inboxReadOnly}>
        <PenLine className="h-3.5 w-3.5" /> Compose
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href="/settings?tab=email">Email setup</Link>}
      />
    </div>
  );

  const selectedLead = React.useMemo(() => {
    const matchFromMessage = (msg: MailDraft | MailSent | MailInbound) => {
      if ("updatedAt" in msg) return null;
      const mid = "uid" in msg ? `${account.id}:in:${msg.id}` : msg.id;
      const manuallyLinked = linkedLeadByMessageId[mid];
      if (manuallyLinked) return leads.find((l) => l.id === manuallyLinked) ?? null;
      const emails = collectMessageEmails(msg);
      return leads.find((lead) => lead.contactEmail && emails.has(lead.contactEmail.toLowerCase())) ?? null;
    };

    if ((mailFolder === "inbox" || mailFolder === "trash") && selectedThread) {
      for (let i = selectedThread.messages.length - 1; i >= 0; i--) {
        const hit = matchFromMessage(selectedThread.messages[i]!);
        if (hit) return hit;
      }
      return null;
    }
    if (!selectedMail) return null;
    return matchFromMessage(selectedMail);
  }, [mailFolder, selectedThread, selectedMail, account.id, linkedLeadByMessageId, leads]);

  function composeLeadContextPayload() {
    if (!selectedLead) return "";
    return JSON.stringify({
      id: selectedLead.id,
      stage: selectedLead.stage,
      company: selectedLead.companyName,
      contact: selectedLead.contactName,
      channel: selectedLead.channel,
    });
  }

  async function generateAiReply() {
    if (!composeBody.trim() && !composeSubject.trim()) {
      toast.error("Open a reply with thread context first, or paste the conversation.");
      return;
    }
    setAiReplyGenerating(true);
    try {
      const thread = composeBody.trim() || composeSubject;
      const res = await fetch("/api/ai/email-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "reply",
          thread,
          leadContext: composeLeadContextPayload(),
          leadId: selectedLead?.id,
          channel: selectedLead?.channel,
          profileId: selectedLead?.profileId,
          campaignId: selectedLead?.campaignId,
          tone: aiReplyTone,
          goal: aiReplyGoal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not generate reply");
        return;
      }
      setComposeBody(data.body ?? "");
      toast.success("Draft generated, review before sending");
    } catch {
      toast.error("Network error");
    } finally {
      setAiReplyGenerating(false);
    }
  }

  async function improviseComposeWithAi() {
    if (!composeBody.trim()) {
      toast.error("Write a message first, then improvise with AI.");
      return;
    }
    setAiReplyGenerating(true);
    try {
      const res = await fetch("/api/ai/email-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "improve",
          draft: composeBody.trim(),
          subject: composeSubject.trim() || undefined,
          leadContext: composeLeadContextPayload(),
          leadId: selectedLead?.id,
          channel: selectedLead?.channel,
          profileId: selectedLead?.profileId,
          campaignId: selectedLead?.campaignId,
          tone: aiReplyTone,
          goal: "Polish and improve clarity while keeping my intent and facts",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not improve message");
        return;
      }
      setComposeBody(data.body ?? "");
      toast.success("Message improved, review before sending");
    } catch {
      toast.error("Network error");
    } finally {
      setAiReplyGenerating(false);
    }
  }

  async function createLeadFromSelectedMessage() {
    if (inboxReadOnly) {
      toast.error("You can’t add leads from another member’s inbox.");
      return;
    }
    const target =
      (mailFolder === "inbox" || mailFolder === "trash") && selectedThread
        ? selectedThread.latest
        : selectedMail;
    if (!target || "updatedAt" in target) return;
    const email = extractPrimaryEmailFromMessage(target);
    if (!email) {
      toast.error("No valid email found in this message.");
      return;
    }
    const domain = email.split("@")[1] ?? "unknown.com";
    const company = domain.split(".")[0] || "Unknown";
    const accountId = `acc-${crypto.randomUUID()}`;
    const contactId = `ct-${crypto.randomUUID()}`;
    const leadId = `ld-${crypto.randomUUID()}`;
    const display = email.split("@")[0].replace(/[._-]/g, " ").trim();
    const name = display ? display.replace(/\b\w/g, (x) => x.toUpperCase()) : email;
    const now = new Date().toISOString();
    try {
      await addAccount({
        id: accountId,
        name: company.charAt(0).toUpperCase() + company.slice(1),
        domain,
        contactCount: 1,
        leadCount: 1,
        openDealValue: 0,
        ownerId: currentUserId,
        createdAt: now,
        updatedAt: now,
      });
      await addContact({
        id: contactId,
        accountId,
        firstName: name.split(" ")[0] ?? name,
        lastName: name.split(" ").slice(1).join(" "),
        fullName: name,
        email,
        ownerId: currentUserId,
        createdAt: now,
        updatedAt: now,
      });
      await addLead({
        id: leadId,
        accountId,
        contactId,
        channel: "personalized_email",
        stage: "new",
        temperature: "warm",
        priority: "medium",
        ownerId: currentUserId,
        contactName: name,
        contactEmail: email,
        companyName: company,
        companyDomain: domain,
        touches: 1,
        isIdle: false,
        createdAt: now,
        updatedAt: now,
      });
      const mid = "uid" in target ? `${account.id}:in:${target.id}` : target.id;
      linkMessageToLead(mid, leadId);
      toast.success("Lead created and linked");
    } catch {
      /* toast shown in workspace provider */
    }
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          !isDemo && mailViewAsUid
            ? inboxReadOnly
              ? `Viewing mail for ${getOwnerDisplayName(mailViewAsUid) ?? "a teammate"}, read only.`
              : `Viewing and sending mail for ${getOwnerDisplayName(mailViewAsUid) ?? "a teammate"}.`
            : "Threaded conversations (like Outlook) from the mailbox you connect in settings."
        }
        actions={pageActions}
      />
      <PageBody className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden p-0">
        <div className="shrink-0 border-b px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
          {inboxReadOnly && mailViewAsUid ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-500 max-w-[42rem]">
              You are viewing another member&apos;s connected inbox in read-only mode. Compose, trash, bulk
              actions, and linking threads to leads are disabled.
            </p>
          ) : null}
          {!inboxReadOnly && mailViewAsUid ? (
            <p className="text-[11px] text-muted-foreground max-w-[42rem]">
              You have shared send access to this inbox. Messages send from the owner&apos;s connected mailbox.
            </p>
          ) : null}
          {!isEmailAccountConfigured(account) && (
            <p className="text-[11px] text-muted-foreground">
              SMTP not fully configured, you can still compose drafts;{" "}
              <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                open Email settings
              </Link>{" "}
              to send.
            </p>
          )}
          {isEmailAccountConfigured(account) && !isImapInboxConfigured(account) && (
            <p className="text-[11px] text-muted-foreground">
              Add IMAP host in{" "}
              <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                Email settings
              </Link>{" "}
              to load incoming mail.
            </p>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2 justify-end">
            {canViewMemberMailboxes && !isDemo ? (
              <Select
                value={mailViewAsUid ?? INBOX_VIEW_SELF}
                onValueChange={(v) => {
                  if (!v || v === INBOX_VIEW_SELF) setMailViewAsUid(null);
                  else setMailViewAsUid(v);
                }}
              >
                <SelectTrigger className="h-8 min-w-[200px] max-w-[min(100%,280px)] text-xs">
                  <SelectValue placeholder="Whose inbox?">
                    {(value) => {
                      if (value == null || value === INBOX_VIEW_SELF) return "My mailbox";
                      const u =
                        memberPickerUsers.find((x) => x.id === value) ??
                        users.find((x) => x.id === value);
                      return u
                        ? workspaceMemberPickerLabel(u, getOwnerDisplayName, { includeRole: true })
                        : fallbackOwnerPickerLabel(String(value));
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INBOX_VIEW_SELF}>My mailbox</SelectItem>
                  {memberPickerUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {workspaceMemberPickerLabel(u, getOwnerDisplayName, { includeRole: true })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={account.id}
              onValueChange={(v) => {
                if (v) {
                  setActiveMailbox(v);
                  clearMailRowSelection();
                }
              }}
            >
              <SelectTrigger className="h-8 min-w-[200px] max-w-[min(100%,280px)]">
                <SelectValue placeholder="Select mailbox">{mailboxDisplayLabel(account)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {mailboxes.map((mb) => (
                  <SelectItem key={mb.id} value={mb.id}>
                    {mailboxDisplayLabel(mb)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 divide-x h-[calc(100vh-12rem)] max-h-[calc(100vh-12rem)]">
            <div className="w-52 shrink-0 flex flex-col border-r p-2 gap-1 overflow-y-auto max-h-[calc(100vh-250px)]">
              <div className="space-y-2 pb-2 border-b border-border/60">
                <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Filter by CRM
                </p>
                <Button
                  variant={entityMailFilter === ENTITY_MAIL_FILTER_ALL ? "secondary" : "ghost"}
                  size="sm"
                  className="group h-7 w-full justify-start px-2 text-[11px]"
                  onClick={() => setEntityMailFilter(ENTITY_MAIL_FILTER_ALL)}
                >
                  <span className="truncate">All conversations</span>
                  <FilterCountBadge stats={inboxMailFilterStats.all} />
                </Button>

                <Collapsible open={leadsFilterOpen} onOpenChange={setLeadsFilterOpen}>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                    <ChevronDown
                      className={cn("h-3 w-3 shrink-0 transition-transform", !leadsFilterOpen && "-rotate-90")}
                      aria-hidden
                    />
                    Leads
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-0.5 pt-0.5">
                    <Button
                      variant={entityMailFilter === ENTITY_LEAD_LINKED ? "secondary" : "ghost"}
                      size="sm"
                      className="group h-7 w-full justify-start px-2 text-[11px]"
                      onClick={() => setEntityMailFilter(ENTITY_LEAD_LINKED)}
                    >
                      <span className="truncate">Matched lead</span>
                      <FilterCountBadge stats={inboxMailFilterStats.leadLinked} />
                    </Button>
                    <Button
                      variant={entityMailFilter === ENTITY_LEAD_UNLINKED ? "secondary" : "ghost"}
                      size="sm"
                      className="group h-7 w-full justify-start px-2 text-[11px]"
                      onClick={() => setEntityMailFilter(ENTITY_LEAD_UNLINKED)}
                    >
                      <span className="truncate">No lead match</span>
                      <FilterCountBadge stats={inboxMailFilterStats.leadUnlinked} />
                    </Button>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={contactsFilterOpen} onOpenChange={setContactsFilterOpen}>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                    <ChevronDown
                      className={cn("h-3 w-3 shrink-0 transition-transform", !contactsFilterOpen && "-rotate-90")}
                      aria-hidden
                    />
                    Contacts
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-0.5 pt-0.5">
                    <Button
                      variant={entityMailFilter === ENTITY_CONTACT_LINKED ? "secondary" : "ghost"}
                      size="sm"
                      className="group h-7 w-full justify-start px-2 text-[11px]"
                      onClick={() => setEntityMailFilter(ENTITY_CONTACT_LINKED)}
                    >
                      <span className="truncate">Matched contact</span>
                      <FilterCountBadge stats={inboxMailFilterStats.contactLinked} />
                    </Button>
                    <Button
                      variant={entityMailFilter === ENTITY_CONTACT_UNLINKED ? "secondary" : "ghost"}
                      size="sm"
                      className="group h-7 w-full justify-start px-2 text-[11px]"
                      onClick={() => setEntityMailFilter(ENTITY_CONTACT_UNLINKED)}
                    >
                      <span className="truncate">No contact match</span>
                      <FilterCountBadge stats={inboxMailFilterStats.contactUnlinked} />
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Folders
              </p>
              {(
                [
                  { id: "inbox" as const, label: "Inbox" },
                  { id: "trash" as const, label: "Trash" },
                  { id: "sent" as const, label: "Sent" },
                  { id: "drafts" as const, label: "Drafts" },
                  { id: "scheduled" as const, label: "Scheduled" },
                ] as const
              ).map((f) => (
                <Button
                  key={f.id}
                  variant={mailFolder === f.id ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start text-xs"
                  onClick={() => {
                    setMailFolder(f.id);
                    setSelectedMailLabelId(null);
                    setSelectedMailFlagId(null);
                    setSelectedMail(null);
                    setSelectedThread(null);
                    setSelectedScheduled(null);
                    clearMailRowSelection();
                    if (f.id === "scheduled") void fetchScheduledEmails();
                    else if (
                      f.id === "sent" &&
                      emailServerHydrated &&
                      !isDemo &&
                      isImapInboxConfigured(account)
                    ) {
                      void fetchSentMail();
                    }
                  }}
                >
                  {f.label}
                  {f.id === "inbox" ? (
                    inboxMailFilterStats.all.unread > 0 ? (
                      <span
                        className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none text-white tabular-nums"
                        title={`${inboxMailFilterStats.all.unread} unread · ${mailboxDisplayLabel(account)}`}
                      >
                        {inboxMailFilterStats.all.unread > 99 ? "99+" : inboxMailFilterStats.all.unread}
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className="ml-auto h-5 max-w-[min(100%,5.75rem)] shrink-0 truncate px-1.5 text-[10px] font-normal"
                        title={mailboxDisplayLabel(account)}
                      >
                        {mailboxDisplayLabel(account)}
                      </Badge>
                    )
                  ) : null}
                  {f.id === "trash" && trashInbound.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums">
                      {trashInbound.length}
                    </Badge>
                  )}
                  {f.id === "sent" && sentForMailbox.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums">
                      {sentForMailbox.length}
                    </Badge>
                  )}
                  {f.id === "drafts" && drafts.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px]">
                      {drafts.length}
                    </Badge>
                  )}
                  {f.id === "scheduled" && scheduledPendingCount > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums">
                      {scheduledPendingCount}
                    </Badge>
                  )}
                </Button>
              ))}
              <MailLabelsSidebarSection
                labels={mailLabels}
                selectedLabelId={selectedMailLabelId}
                labelCounts={mailLabelCounts}
                disabled={inboxReadOnly}
                onSelectLabel={setSelectedMailLabelId}
                onClearLabel={() => setSelectedMailLabelId(null)}
                onCreateLabel={handleCreateMailLabel}
                onDeleteLabel={handleDeleteMailLabel}
              />
              <MailFlagsSidebarSection
                flagCounts={mailFlagCounts}
                flaggedTotal={flaggedMailTotal}
                selectedFlagId={selectedMailFlagId}
                onSelectFlag={setSelectedMailFlagId}
                onClearFlag={() => setSelectedMailFlagId(null)}
              />
              <div className="mt-auto pt-2 border-t">
                <Button variant="outline" size="sm" className="w-full text-xs" disabled={inboxReadOnly} onClick={() => openCompose()}>
                  <PenLine className="h-3 w-3 mr-1" />
                  Compose
                </Button>
              </div>
            </div>

            <div className="w-full max-w-md flex flex-col border-r max-h-[calc(100vh-250px)] overflow-y-auto">
              <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground capitalize space-y-2">
                <div className="flex items-center justify-between gap-2 normal-case">
                  <span>
                    {selectedMailLabel
                      ? selectedMailLabel.name
                      : selectedMailFlagId
                        ? mailFlagById(selectedMailFlagId)?.name ?? "Flagged"
                        : mailFolder === "scheduled"
                          ? "Scheduled"
                          : mailFolder}
                  </span>
                  {mailFolder === "scheduled" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7 shrink-0"
                      disabled={scheduledLoading}
                      onClick={() => void fetchScheduledEmails()}
                      aria-label="Refresh scheduled emails"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", scheduledLoading && "animate-spin")} />
                    </Button>
                  ) : null}
                </div>
                {mailFolder === "scheduled" ? (
                  <div className="flex gap-1 normal-case">
                    <Button
                      type="button"
                      variant={scheduledTab === "pending" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        setScheduledTab("pending");
                        setSelectedScheduled(null);
                      }}
                    >
                      Pending
                    </Button>
                    <Button
                      type="button"
                      variant={scheduledTab === "done" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        setScheduledTab("done");
                        setSelectedScheduled(null);
                      }}
                    >
                      Sent & history
                    </Button>
                  </div>
                ) : null}
                {mailFolder === "inbox" &&
                  imapMailboxTotal != null &&
                  imapMailboxTotal > inbound.length && (
                    <div className="font-normal text-[10px] leading-snug normal-case">
                      Loaded newest {inbound.length} of {imapMailboxTotal} messages in INBOX
                    </div>
                  )}
                {mailFolder === "inbox" && isImapInboxConfigured(account) && inboundSyncing && (
                  <div className="flex items-center gap-1.5 font-normal text-[10px] text-muted-foreground normal-case">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                    Syncing with server…
                  </div>
                )}
                {mailFolder === "trash" &&
                  imapTrashTotal != null &&
                  imapTrashTotal > trashInbound.length && (
                    <div className="font-normal text-[10px] leading-snug normal-case">
                      Loaded newest {trashInbound.length} of {imapTrashTotal} messages in Trash
                    </div>
                  )}
                {mailFolder === "trash" && isImapInboxConfigured(account) && trashSyncing && (
                  <div className="flex items-center gap-1.5 font-normal text-[10px] text-muted-foreground normal-case">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                    Syncing Trash…
                  </div>
                )}
                {mailFolder === "sent" &&
                  imapSentTotal != null &&
                  imapSentTotal > sentForMailbox.filter((m) => m.uid != null).length && (
                    <div className="font-normal text-[10px] leading-snug normal-case">
                      Loaded newest {sentForMailbox.filter((m) => m.uid != null).length} of {imapSentTotal}{" "}
                      messages in Sent
                    </div>
                  )}
                {mailFolder === "sent" && isImapInboxConfigured(account) && sentSyncing && (
                  <div className="flex items-center gap-1.5 font-normal text-[10px] text-muted-foreground normal-case">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
                    Syncing Sent…
                  </div>
                )}
                {showImapBulkMailActions && emailFolderSupportsImapList && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 normal-case">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2"
                      onClick={selectAllVisibleMailRows}
                      disabled={visibleMailRows.length === 0 || mailActionLoading}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px] px-2"
                      onClick={clearMailRowSelection}
                      disabled={selectedMailRowIds.size === 0}
                    >
                      Clear
                    </Button>
                    {(mailFolder === "inbox" || mailFolder === "trash") && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] px-2 gap-1"
                          disabled={
                            selectedUnreadUids.length === 0 || mailActionLoading
                          }
                          onClick={() => void handleMarkSelectionAsRead()}
                        >
                          {mailActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <MailOpen className="h-3 w-3" />
                          )}
                          Mark as read
                          {selectedUnreadUids.length > 0
                            ? ` (${selectedUnreadUids.length})`
                            : ""}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] px-2 gap-1"
                          disabled={selectedSeenUids.length === 0 || mailActionLoading}
                          onClick={() => void handleMarkSelectionAsUnread()}
                        >
                          {mailActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Mail className="h-3 w-3" />
                          )}
                          Mark as unread
                          {selectedSeenUids.length > 0
                            ? ` (${selectedSeenUids.length})`
                            : ""}
                        </Button>
                      </>
                    )}
                    {(mailFolder === "inbox" || mailFolder === "trash" || mailFolder === "sent") && (
                      <MailLabelPicker
                        labels={mailLabels}
                        selectedLabelIds={selectedRowsLabelIds}
                        disabled={inboxReadOnly || selectedMailRowIds.size === 0}
                        onToggleLabel={handleToggleLabelOnSelection}
                        onRemoveLabel={handleRemoveLabelFromSelection}
                        onCreateLabel={handleCreateMailLabel}
                        filterLabel={selectedMailLabel}
                        buttonLabel={
                          selectedMailRowIds.size > 0
                            ? `Label (${selectedMailRowIds.size})`
                            : "Label"
                        }
                        size="sm"
                        className="h-7 text-[10px] px-2"
                      />
                    )}
                    {(mailFolder === "inbox" || mailFolder === "trash" || mailFolder === "sent") && (
                      <MailFlagPicker
                        currentFlagId={
                          selectedMailRowIds.size > 0 ? selectedRowsFlagId : openThreadFlagId
                        }
                        disabled={
                          inboxReadOnly ||
                          (selectedMailRowIds.size === 0 && !selectedThread)
                        }
                        onSetFlag={
                          selectedThread && selectedMailRowIds.size === 0
                            ? handleSetFlagOnOpenThread
                            : handleSetFlagOnSelection
                        }
                        onClearFlag={
                          selectedThread && selectedMailRowIds.size === 0
                            ? handleClearFlagOnOpenThread
                            : handleClearFlagOnSelection
                        }
                        onToggleFlag={
                          selectedThread && selectedMailRowIds.size === 0
                            ? handleToggleFlagOnOpenThread
                            : handleToggleFlagOnSelection
                        }
                        size="sm"
                        className="h-7 text-[10px] px-2"
                      />
                    )}
                    {selectedMailLabel &&
                    (mailFolder === "inbox" || mailFolder === "trash" || mailFolder === "sent") ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                        disabled={
                          inboxReadOnly ||
                          (selectedMailRowIds.size === 0 && !selectedThread)
                        }
                        onClick={handleRemoveFromActiveLabelFilter}
                      >
                        <X className="h-3 w-3" />
                        Remove from “{selectedMailLabel.name}”
                      </Button>
                    ) : null}
                    {mailFolder === "inbox" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[10px] px-2 gap-1"
                        disabled={selectedMailRowIds.size === 0 || mailActionLoading}
                        onClick={() => void handleMoveInboxSelectionToTrash()}
                      >
                        {mailActionLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Move to trash ({selectedMailRowIds.size})
                      </Button>
                    )}
                    {mailFolder === "trash" && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 text-[10px] px-2 gap-1"
                          disabled={selectedMailRowIds.size === 0 || mailActionLoading}
                          onClick={() => void handleRestoreTrashSelection()}
                        >
                          {mailActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ArchiveRestore className="h-3 w-3" />
                          )}
                          Restore to inbox ({selectedMailRowIds.size})
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-7 text-[10px] px-2 gap-1"
                          disabled={selectedMailRowIds.size === 0 || mailActionLoading}
                          onClick={() => setPurgeTrashOpen(true)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete forever ({selectedMailRowIds.size})
                        </Button>
                      </>
                    )}
                  </div>
                )}
                <div className="space-y-2 normal-case">
                  {(mailFolder === "inbox" || mailFolder === "trash") && (
                    <div className="space-y-1">
                    <div
                      className="flex flex-wrap gap-1"
                      role="group"
                      aria-label="Filter by read status"
                    >
                      <Button
                        type="button"
                        variant={readStatusFilter === READ_STATUS_FILTER_ALL ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 text-[10px] px-2 gap-1"
                        onClick={() => setReadStatusFilter(READ_STATUS_FILTER_ALL)}
                      >
                        All
                        <span className="tabular-nums text-muted-foreground">{readFilterStats.total}</span>
                      </Button>
                      <Button
                        type="button"
                        variant={readStatusFilter === READ_STATUS_UNREAD ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 text-[10px] px-2 gap-1"
                        onClick={() => setReadStatusFilter(READ_STATUS_UNREAD)}
                      >
                        <Mail className="h-3 w-3 shrink-0" aria-hidden />
                        Unread
                        {readFilterStats.unread > 0 ? (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white tabular-nums">
                            {readFilterStats.unread > 99 ? "99+" : readFilterStats.unread}
                          </span>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">0</span>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant={readStatusFilter === READ_STATUS_READ ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 text-[10px] px-2 gap-1"
                        onClick={() => setReadStatusFilter(READ_STATUS_READ)}
                      >
                        <MailOpen className="h-3 w-3 shrink-0" aria-hidden />
                        Read
                        <span className="tabular-nums text-muted-foreground">{readFilterStats.read}</span>
                      </Button>
                    </div>
                    {readStatusFilter === READ_STATUS_UNREAD ? (
                      <p className="text-[10px] text-muted-foreground font-normal leading-snug">
                        Opening a message does not mark it read. Use Mark as read when you are done, or switch to All.
                      </p>
                    ) : null}
                    </div>
                  )}
                  {listFilterActive ? (
                    <p className="text-[10px] text-muted-foreground font-normal leading-snug">
                      Filter: <span className="text-foreground">{activeListFilterSummary}</span>
                      <button
                        type="button"
                        className="ml-1.5 text-primary underline-offset-2 hover:underline"
                        onClick={clearAllListFilters}
                      >
                        Clear
                      </button>
                    </p>
                  ) : null}
                  {showEntitySubFilter && entitySubFilterOptions.length > 0 ? (
                    <div className="space-y-1">
                      <Label htmlFor="inbox-entity-sub-filter" className="text-[10px] text-muted-foreground font-normal">
                        {entityMailFilter === ENTITY_LEAD_LINKED ? "Lead" : "Contact"}
                      </Label>
                      <Select
                        value={entitySubFilter}
                        onValueChange={(v) => {
                          if (v) setEntitySubFilter(v);
                        }}
                      >
                        <SelectTrigger
                          id="inbox-entity-sub-filter"
                          className="h-8 w-full min-w-0 max-w-full text-xs font-normal"
                        >
                          <SelectValue placeholder="All matched">
                            {entitySubFilter === ENTITY_SUB_FILTER_ALL
                              ? entityMailFilter === ENTITY_LEAD_LINKED
                                ? "All matched leads"
                                : "All matched contacts"
                              : entitySubFilterOptions.find((o) => o.id === entitySubFilter)?.label ??
                                "Selected"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectGroup>
                            <SelectItem value={ENTITY_SUB_FILTER_ALL}>
                              {entityMailFilter === ENTITY_LEAD_LINKED
                                ? "All matched leads"
                                : "All matched contacts"}
                            </SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel className="text-[10px]">
                              {entityMailFilter === ENTITY_LEAD_LINKED ? "Specific lead" : "Specific contact"}
                            </SelectLabel>
                            {entitySubFilterOptions.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                <span className="flex w-full items-center justify-between gap-2">
                                  <span className="truncate">{o.label}</span>
                                  {o.stats.unread > 0 ? (
                                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white tabular-nums">
                                      {o.stats.unread > 99 ? "99+" : o.stats.unread}
                                    </span>
                                  ) : (
                                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                      {o.stats.total}
                                    </span>
                                  )}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="relative normal-case">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={listSearchQuery}
                      onChange={(e) => setListSearchQuery(e.target.value)}
                      placeholder="Search subject, sender, body…"
                      className="h-8 pl-8 text-xs font-normal"
                      aria-label="Search mail"
                    />
                  </div>
                  {emailFolderSupportsImapList && showImapBulkMailActions && visibleMailRows.length > 0 ? (
                    <p className="text-[10px] text-muted-foreground font-normal leading-snug">
                      {mailFolder === "trash"
                        ? "↑↓ move · Space select · Shift+Space range · Delete delete forever"
                        : "↑↓ move · Space select · Shift+Space range · Delete trash"}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y">
                {mailFolder === "inbox" && !isImapInboxConfigured(account) && (
                  <div className="p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Enter your IMAP server, username, and password in{" "}
                      <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                        Settings → Email
                      </Link>{" "}
                      (along with SMTP for sending). Then return here to load your inbox.
                    </p>
                  </div>
                )}
                {mailFolder === "inbox" && isImapInboxConfigured(account) && inboundLoading && inbound.length === 0 && (
                  <div className="p-8 flex justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
                {mailFolder === "inbox" &&
                  isImapInboxConfigured(account) &&
                  !inboundLoading &&
                  !inboundSyncing &&
                  inbound.length === 0 && (
                    <div className="p-6 text-center text-sm text-muted-foreground">No messages in INBOX.</div>
                  )}
                {mailFolder === "trash" && !isDemo && !isImapInboxConfigured(account) && (
                  <div className="p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Add IMAP in{" "}
                      <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                        Settings → Email
                      </Link>{" "}
                      to load Trash from your mail server.
                    </p>
                  </div>
                )}
                {mailFolder === "trash" &&
                  isImapInboxConfigured(account) &&
                  trashLoading &&
                  trashInbound.length === 0 && (
                    <div className="p-8 flex justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}
                {mailFolder === "trash" &&
                  !trashLoading &&
                  !trashSyncing &&
                  trashInbound.length === 0 &&
                  (isImapInboxConfigured(account) || isDemo) && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Trash is empty.</div>
                  )}
                {mailFolder === "sent" && !isDemo && !isImapInboxConfigured(account) && (
                  <div className="p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Add IMAP in{" "}
                      <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                        Settings → Email
                      </Link>{" "}
                      to sync your mail server Sent folder (Gmail web, mobile, Nova, and other clients). SMTP alone only
                      sends mail; it does not load Sent.
                    </p>
                  </div>
                )}
                {mailFolder === "sent" &&
                  isImapInboxConfigured(account) &&
                  sentLoading &&
                  sentForMailbox.length === 0 && (
                    <div className="p-8 flex justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}
                {mailFolder === "sent" &&
                  sentFetchError &&
                  !sentLoading &&
                  !sentSyncing &&
                  sentForMailbox.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground space-y-2">
                    <p>{sentFetchError}</p>
                    {isImapInboxConfigured(account) && !inboxReadOnly ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void fetchSentMail()}>
                        <RefreshCw className="h-3.5 w-3.5" /> Try again
                      </Button>
                    ) : null}
                  </div>
                )}
                {mailFolder === "sent" &&
                  !sentLoading &&
                  !sentSyncing &&
                  mailListRows.length === 0 &&
                  (isImapInboxConfigured(account) || isDemo) && (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {isDemo
                        ? "Nothing here yet."
                        : sentFetchError
                          ? sentFetchError
                          : "No messages in Sent. With IMAP configured, mail sent from Gmail and other clients appears here."}
                    </div>
                  )}
                {mailFolder === "drafts" && mailListRows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">Nothing here yet.</div>
                )}
                {mailFolder === "scheduled" && scheduledLoading && mailListRows.length === 0 && (
                  <div className="p-8 flex justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
                {mailFolder === "scheduled" && !scheduledLoading && mailListRows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {scheduledTab === "pending"
                      ? "No pending scheduled emails. Compose a message and choose Schedule send."
                      : "No sent or completed scheduled emails yet."}
                  </div>
                )}
                {listFilterActive && mailListRows.length > 0 && visibleMailRows.length === 0 && (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No messages match your current filters.
                      {readStatusFilterActive && readStatusFilter === READ_STATUS_UNREAD
                        ? " Try All or load more of your inbox."
                        : null}
                    </div>
                  )}
                {visibleMailRows.map((row, rowIndex) => {
                  const isRowSelected = row.scheduled
                    ? selectedScheduled?.id === row.scheduled.id
                    : row.thread
                      ? selectedThread?.threadId === row.thread.threadId
                      : selectedMail?.id === row.row.id && selectedThread == null;
                  const showSelect = showImapBulkMailActions && emailFolderSupportsImapList;
                  const bulkChecked = selectedMailRowIds.has(row.id);
                  const rowLabelIds = labelIdsForRow(row, account.id, mailFolder, labelsByMessageId);
                  const rowFlagId = flagIdForRow(row, account.id, mailFolder, flagByMessageId);
                  return (
                    <div
                      key={row.id}
                      ref={(el) => {
                        if (el) mailRowElByIdRef.current.set(row.id, el);
                        else mailRowElByIdRef.current.delete(row.id);
                      }}
                      className="flex items-stretch gap-0 border-b border-border/60 last:border-b-0"
                    >
                      {showSelect ? (
                        <div
                          className="flex w-9 shrink-0 items-center justify-center border-r border-border/60 bg-muted/5"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleMailRowBulkSelect(row.id, rowIndex, e.shiftKey);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          role="presentation"
                        >
                          <Checkbox
                            checked={bulkChecked}
                            tabIndex={-1}
                            aria-label={row.thread ? "Select conversation" : "Select message"}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        data-mail-list-row
                        onClick={() => selectVisibleMailRow(row)}
                        className={cn(
                          "min-w-0 flex-1 text-left px-3 py-2.5 hover:bg-muted/20 text-sm",
                          isRowSelected && "bg-muted/30",
                          row.muted && "opacity-80",
                        )}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {rowLabelIds.length > 0 ? (
                            <MailLabelChips
                              labelIds={rowLabelIds}
                              labels={mailLabels}
                              className="mt-0.5 shrink-0 max-w-[5rem]"
                              max={1}
                              disabled={inboxReadOnly}
                              onRemoveLabel={(labelId) => handleRemoveLabelFromMailRow(row, labelId)}
                            />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <div
                              className={cn(
                                "truncate",
                                !row.muted && mailFolder === "inbox" && "font-medium",
                              )}
                            >
                              {row.thread?.messages.some((m) => (m.attachments?.length ?? 0) > 0) ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Paperclip
                                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                    aria-label="Has attachment"
                                  />
                                  <span className="truncate">{row.title}</span>
                                </span>
                              ) : (
                                row.title
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
                            {rowFlagId ? (
                              <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <MailFlagIcon flagId={rowFlagId} className="h-3 w-3 shrink-0" />
                                <span className="truncate">{mailFlagById(rowFlagId)?.name ?? "Flagged"}</span>
                              </div>
                            ) : null}
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {fmtRelative(row.at)}
                            </div>
                          </div>
                          {row.thread && row.thread.messages.length > 1 && (
                            <Badge variant="secondary" className="shrink-0 h-5 px-1.5 text-[10px] tabular-nums">
                              {row.thread.messages.length}
                            </Badge>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
                {mailFolder === "inbox" &&
                  !isDemo &&
                  isImapInboxConfigured(account) &&
                  imapMailboxTotal != null &&
                  imapMailboxTotal > inbound.length && (
                    <div className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full gap-2 text-xs"
                        disabled={inboundLoading || inboundLoadingMore || inboundSyncing}
                        onClick={() => void loadMoreInboundMail()}
                      >
                        {inboundLoadingMore ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        Load older messages ({inbound.length} of {imapMailboxTotal})
                      </Button>
                    </div>
                  )}
                {mailFolder === "sent" &&
                  !isDemo &&
                  isImapInboxConfigured(account) &&
                  imapSentTotal != null &&
                  imapSentTotal > sentForMailbox.filter((m) => m.uid != null).length && (
                    <div className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full gap-2 text-xs"
                        disabled={sentLoading || sentLoadingMore || sentSyncing}
                        onClick={() => void loadMoreSentMail()}
                      >
                        {sentLoadingMore ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        Load older sent ({sentForMailbox.filter((m) => m.uid != null).length} of {imapSentTotal})
                      </Button>
                    </div>
                  )}
              </div>
            </div>

            <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden p-4 lg:p-5">
              {(mailFolder === "inbox" || mailFolder === "trash") && selectedThread ? (
                <div className="flex h-full min-h-0 w-full flex-col">
                  <div className="shrink-0 space-y-3 border-b pb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold leading-snug">{selectedThread.conversationSubject}</h3>
                        {selectedThread.messages.length > 1 ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {selectedThread.messages.length} messages
                          </Badge>
                        ) : null}
                      </div>
                      {openThreadFlagId ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MailFlagIcon flagId={openThreadFlagId} className="h-3.5 w-3.5" />
                          {mailFlagById(openThreadFlagId)?.name ?? "Flagged"}
                        </div>
                      ) : null}
                      {openThreadLabelIds.length > 0 ? (
                        <MailLabelChips
                          labelIds={openThreadLabelIds}
                          labels={mailLabels}
                          max={6}
                          disabled={inboxReadOnly}
                          onRemoveLabel={handleRemoveLabelFromOpenThread}
                        />
                      ) : null}
                      <p className="text-xs text-muted-foreground mt-1">
                        Latest {fmtRelative(selectedThread.latest.date)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Message actions">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={inboxReadOnly}
                        onClick={() => {
                          const latest = selectedThread.latest;
                          const addr = replyRecipientAddress(latest);
                          if (!addr) {
                            toast.error("Could not read a reply address from this conversation.");
                            return;
                          }
                          openCompose({
                            to: addr,
                            subject: replySubject(latest.subject),
                            body: withMailboxSignature(replyQuotedBody(latest), account.signature),
                            ...replyContextForMessage(latest),
                          });
                        }}
                      >
                        <Reply className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Reply
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        disabled={inboxReadOnly}
                        onClick={() => {
                          const latest = selectedThread.latest;
                          const pack = replyAllRecipientLine(latest, account);
                          if (!pack.to) {
                            toast.error("Could not read a reply address from this conversation.");
                            return;
                          }
                          openCompose({
                            to: pack.to,
                            cc: pack.cc,
                            subject: replySubject(latest.subject),
                            body: withMailboxSignature(replyQuotedBody(latest), account.signature),
                            ...replyContextForMessage(latest),
                          });
                        }}
                      >
                        <ReplyAll className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Reply all
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        disabled={inboxReadOnly}
                        onClick={() => {
                          const latest = selectedThread.latest;
                          openCompose({
                            to: "",
                            cc: "",
                            subject: forwardSubject(latest.subject),
                            body: withMailboxSignature(forwardedBody(latest), account.signature),
                            attachments: composeAttachmentsFromInbound(latest.attachments),
                          });
                        }}
                      >
                        <Forward className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Forward
                      </Button>
                      <InboxReadingToolbarExtras
                        messages={selectedThread.messages}
                        mailFolder={mailFolder}
                        inboxReadOnly={inboxReadOnly}
                        blockedSenderDomains={blockedSenderDomains}
                        onRequestBlockDomain={openBlockDomainDialog}
                      />
                      {(mailFolder === "inbox" || mailFolder === "trash") && (
                        <MailLabelPicker
                          labels={mailLabels}
                          selectedLabelIds={openThreadLabelIds}
                          disabled={inboxReadOnly}
                          onToggleLabel={handleToggleLabelOnOpenThread}
                          onRemoveLabel={handleRemoveLabelFromOpenThread}
                          onCreateLabel={handleCreateMailLabel}
                          filterLabel={selectedMailLabel}
                          buttonLabel={
                            openThreadLabelIds.length > 0
                              ? `Labels (${openThreadLabelIds.length})`
                              : "Label"
                          }
                        />
                      )}
                      {(mailFolder === "inbox" || mailFolder === "trash") && (
                        <MailFlagPicker
                          currentFlagId={openThreadFlagId}
                          disabled={inboxReadOnly}
                          onSetFlag={handleSetFlagOnOpenThread}
                          onClearFlag={handleClearFlagOnOpenThread}
                          onToggleFlag={handleToggleFlagOnOpenThread}
                        />
                      )}
                      {(mailFolder === "inbox" || mailFolder === "trash") &&
                        (selectedThread.hasUnread ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={inboxReadOnly && !isDemo}
                            onClick={() => markThreadAsRead(selectedThread)}
                          >
                            <MailOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Mark as read
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={inboxReadOnly && !isDemo}
                            onClick={() => markThreadAsUnread(selectedThread)}
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Mark as unread
                          </Button>
                        ))}
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-3 pr-1">
                    {selectedThread.messages.map((m, msgIndex) => (
                      <ThreadInboundMessage
                        key={m.uid}
                        message={m}
                        expanded={expandedThreadUids.has(m.uid)}
                        collapsible={selectedThread.messages.length > 1}
                        isLatest={msgIndex === selectedThread.messages.length - 1}
                        onToggle={() => toggleThreadMessageExpanded(m.uid)}
                      />
                    ))}
                  </div>

                  <div className="shrink-0 flex flex-wrap gap-2 border-t pt-4 mt-2">
                    {mailFolder === "inbox" && canUseTrashFeatures && !inboxReadOnly && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                        disabled={mailActionLoading}
                        onClick={() =>
                          void moveInboxUidsToTrashNow(selectedThread.messages.map((m) => m.uid))
                        }
                      >
                        {mailActionLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Move to trash
                      </Button>
                    )}
                    {mailFolder === "trash" && canUseTrashFeatures && !inboxReadOnly && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1.5"
                          disabled={mailActionLoading}
                          onClick={() =>
                            void restoreTrashUidsToInboxNow(selectedThread.messages.map((m) => m.uid))
                          }
                        >
                          {mailActionLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          )}
                          Restore to inbox
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1.5"
                          disabled={mailActionLoading}
                          onClick={() => {
                            clearMailRowSelection();
                            setPurgeTrashOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete forever
                        </Button>
                      </>
                    )}
                    {selectedLead ? (
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/leads/${selectedLead.id}?tab=emails`}>Open lead</Link>}
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={inboxReadOnly}
                        onClick={createLeadFromSelectedMessage}
                      >
                        Add to leads
                      </Button>
                    )}
                  </div>
                  {selectedLead ? (
                    <div className="rounded-lg border p-3 text-xs bg-muted/10 shrink-0 mt-2">
                      Linked lead:{" "}
                      <Link className="text-primary hover:underline" href={`/leads/${selectedLead.id}?tab=emails`}>
                        {selectedLead.contactName} - {selectedLead.companyName}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : selectedScheduled ? (
                <div className="space-y-4 max-w-xl">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{selectedScheduled.subject || "(no subject)"}</h3>
                      <Badge
                        variant={
                          selectedScheduled.status === "pending" ||
                          selectedScheduled.status === "processing"
                            ? "secondary"
                            : selectedScheduled.status === "sent"
                              ? "outline"
                              : "destructive"
                        }
                        className="text-[10px] capitalize"
                      >
                        {selectedScheduled.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">To: {selectedScheduled.to}</p>
                    {selectedScheduled.cc ? (
                      <p className="text-xs text-muted-foreground">Cc: {selectedScheduled.cc}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedScheduled.status === "processing"
                        ? "Sending now"
                        : selectedScheduled.status === "pending"
                          ? `Scheduled for ${format(new Date(selectedScheduled.scheduledAt), "MMM d, yyyy 'at' h:mm a")}`
                          : selectedScheduled.sentAt
                            ? `Sent ${format(new Date(selectedScheduled.sentAt), "MMM d, yyyy 'at' h:mm a")}`
                            : fmtRelative(selectedScheduled.scheduledAt)}
                    </p>
                    {selectedScheduled.error ? (
                      <p className="text-xs text-destructive mt-1">{selectedScheduled.error}</p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
                    {selectedScheduled.body}
                  </div>
                  {selectedScheduled.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={inboxReadOnly}
                        onClick={() =>
                          openCompose({
                            to: selectedScheduled.to,
                            cc: selectedScheduled.cc,
                            subject: selectedScheduled.subject,
                            body: selectedScheduled.body,
                            inReplyTo: selectedScheduled.inReplyTo,
                            referenceIds: selectedScheduled.referenceIds,
                          })
                        }
                      >
                        Edit in compose
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={inboxReadOnly}
                        onClick={() => void cancelScheduledEmail(selectedScheduled.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Cancel schedule
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : selectedMail ? (
                "sentAt" in selectedMail ? (
                  <div className="space-y-4 max-w-xl">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">{selectedMail.subject || "(no subject)"}</h3>
                        <p className="text-xs text-muted-foreground mt-1">To: {selectedMail.to}</p>
                        {selectedMail.from ? (
                          <p className="text-xs text-muted-foreground">From: {selectedMail.from}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">{fmtRelative(selectedMail.sentAt)}</p>
                      </div>
                      <MailReadingZoomActions content={mailReaderContentFromSent(selectedMail)} />
                    </div>
                    {selectedMail.bodySynced === false && !selectedMail.body ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading message…
                      </div>
                    ) : selectedMail.bodyHtml ? (
                      <div
                        className="rounded-lg border bg-muted/10 p-4 text-sm prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: selectedMail.bodyHtml }}
                      />
                    ) : (
                      <div className="rounded-lg border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
                        {selectedMail.body || selectedMail.preview || ""}
                      </div>
                    )}
                  </div>
                ) : "updatedAt" in selectedMail ? (
                  <div className="space-y-4 max-w-xl">
                    <div>
                      <h3 className="text-sm font-semibold">{selectedMail.subject || "(no subject)"}</h3>
                      <p className="text-xs text-muted-foreground mt-1">To: {selectedMail.to}</p>
                      {selectedMail.cc ? (
                        <p className="text-xs text-muted-foreground">Cc: {selectedMail.cc}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">{fmtRelative(selectedMail.updatedAt)}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/10 p-4 text-sm whitespace-pre-wrap">{selectedMail.body}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={inboxReadOnly}
                        onClick={() =>
                          openCompose({
                            id: selectedMail.id,
                            to: selectedMail.to,
                            cc: selectedMail.cc,
                            subject: selectedMail.subject,
                            body: selectedMail.body,
                            attachments: selectedMail.attachments,
                            inReplyTo: selectedMail.inReplyTo,
                            referenceIds: selectedMail.referenceIds,
                          })
                        }
                      >
                        Edit & send
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={inboxReadOnly}
                        onClick={() => {
                          deleteDraft(selectedMail.id);
                          setSelectedMail(null);
                          toast.success("Draft deleted");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 w-full flex-col">
                    <div className="shrink-0 space-y-3 border-b pb-4">
                      <h3 className="text-base font-semibold leading-snug">{selectedMail.subject || "(no subject)"}</h3>
                      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Message actions">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={inboxReadOnly}
                          onClick={() => {
                            const addr = replyRecipientAddress(selectedMail);
                            if (!addr) {
                              toast.error("Could not read a reply address from this message.");
                              return;
                            }
                            openCompose({
                              to: addr,
                              subject: replySubject(selectedMail.subject),
                              body: withMailboxSignature(replyQuotedBody(selectedMail), account.signature),
                              ...replyContextForMessage(selectedMail),
                            });
                          }}
                        >
                          <Reply className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Reply
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1.5"
                          disabled={inboxReadOnly}
                          onClick={() => {
                            const pack = replyAllRecipientLine(selectedMail, account);
                            if (!pack.to) {
                              toast.error("Could not read a reply address from this message.");
                              return;
                            }
                            openCompose({
                              to: pack.to,
                              cc: pack.cc,
                              subject: replySubject(selectedMail.subject),
                              body: withMailboxSignature(replyQuotedBody(selectedMail), account.signature),
                              ...replyContextForMessage(selectedMail),
                            });
                          }}
                        >
                          <ReplyAll className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Reply all
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1.5"
                          disabled={inboxReadOnly}
                          onClick={() => {
                            openCompose({
                              to: "",
                              cc: "",
                              subject: forwardSubject(selectedMail.subject),
                              body: withMailboxSignature(forwardedBody(selectedMail), account.signature),
                              attachments: composeAttachmentsFromInbound(selectedMail.attachments),
                            });
                          }}
                        >
                          <Forward className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Forward
                        </Button>
                        <InboxReadingToolbarExtras
                          messages={[selectedMail]}
                          mailFolder={mailFolder}
                          inboxReadOnly={inboxReadOnly}
                          blockedSenderDomains={blockedSenderDomains}
                          onRequestBlockDomain={openBlockDomainDialog}
                        />
                        <MailReadingZoomActions content={mailReaderContentFromInbound(selectedMail)} />
                      </div>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-3 pr-1">
                      <InboundMessageCard message={selectedMail} fillHeight />
                    </div>
                    <div className="shrink-0 flex flex-wrap gap-2 border-t pt-4 mt-2">
                      {mailFolder === "inbox" && canUseTrashFeatures && !inboxReadOnly && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                          disabled={mailActionLoading}
                          onClick={() => void moveInboxUidsToTrashNow([selectedMail.uid])}
                        >
                          {mailActionLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Move to trash
                        </Button>
                      )}
                      {mailFolder === "trash" && canUseTrashFeatures && !inboxReadOnly && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-1.5"
                            disabled={mailActionLoading}
                            onClick={() => void restoreTrashUidsToInboxNow([selectedMail.uid])}
                          >
                            {mailActionLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArchiveRestore className="h-3.5 w-3.5" />
                            )}
                            Restore to inbox
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="gap-1.5"
                            disabled={mailActionLoading}
                            onClick={() => void permanentlyDeleteTrashUidsNow([selectedMail.uid])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete forever
                          </Button>
                        </>
                      )}
                      {selectedLead ? (
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/leads/${selectedLead.id}?tab=emails`}>Open lead</Link>}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inboxReadOnly}
                          onClick={createLeadFromSelectedMessage}
                        >
                          Add to leads
                        </Button>
                      )}
                    </div>
                    {selectedLead ? (
                      <div className="rounded-lg border p-3 text-xs bg-muted/10 shrink-0 mt-2">
                        Linked lead:{" "}
                        <Link className="text-primary hover:underline" href={`/leads/${selectedLead.id}?tab=emails`}>
                          {selectedLead.contactName} - {selectedLead.companyName}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )
              ) : (
                <EmptyState
                  icon={Mail}
                  title={
                    mailFolder === "inbox" || mailFolder === "trash"
                      ? "Select a conversation"
                      : mailFolder === "scheduled"
                        ? "Select a scheduled email"
                        : "Select a message"
                  }
                  description={
                    mailFolder === "inbox"
                      ? isImapInboxConfigured(account) || isDemo
                        ? "Choose a thread from the list or refresh. Replies are grouped like Outlook when headers match."
                        : "Configure IMAP in Email settings, then open Inbox to load messages."
                      : mailFolder === "trash"
                        ? "Open Trash to review messages removed from your inbox. Deleting here removes them from the server permanently."
                        : mailFolder === "scheduled"
                          ? "Pick a scheduled email from the list, or compose and use Schedule send."
                          : "Pick an item from the list or compose a new message."
                  }
                />
              )}
            </div>
          </div>
      </PageBody>

      <AlertDialog open={blockDomainOpen} onOpenChange={setBlockDomainOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {blockDomainTarget || "this domain"}?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left sm:text-left">
              {blockDomainPendingStats.messages > 0 ? (
                <span className="block">
                  <span className="font-semibold text-foreground tabular-nums">
                    {blockDomainPendingStats.messages}
                  </span>{" "}
                  {blockDomainPendingStats.messages === 1 ? "message" : "messages"}
                  {blockDomainPendingStats.conversations > 0 ? (
                    <>
                      {" "}
                      in{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {blockDomainPendingStats.conversations}
                      </span>{" "}
                      {blockDomainPendingStats.conversations === 1 ? "conversation" : "conversations"}
                    </>
                  ) : null}{" "}
                  in your loaded inbox will move to Trash now.
                </span>
              ) : (
                <span className="block">
                  No messages from this domain are in your loaded inbox right now. Future mail will still go to Trash
                  automatically.
                </span>
              )}
              <span className="block">
                All future email from{" "}
                <span className="font-medium text-foreground">{blockDomainTarget}</span> will be moved to Trash when
                your inbox syncs. Open Trash to review, nothing is deleted until you use Select all and Delete forever.
              </span>
              {imapMailboxTotal != null && inbound.length < imapMailboxTotal ? (
                <span className="block text-xs">
                  Count is from {inbound.length} of {imapMailboxTotal} inbox messages loaded. Older mail from this
                  domain on the server may not be included until you load more or refresh.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mailActionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mailActionLoading}
              onClick={(e) => {
                e.preventDefault();
                void confirmBlockSenderDomain();
              }}
            >
              {mailActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Block domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeTrashOpen} onOpenChange={setPurgeTrashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedMailRowIds.size > 0
                ? `This will permanently remove ${selectedMailRowIds.size} selected conversation(s) from Trash on your mail server. They cannot be recovered.`
                : selectedThread
                  ? "This conversation will be permanently removed from Trash on your mail server. It cannot be recovered."
                  : "Selected messages will be permanently removed from Trash on your mail server."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={mailActionLoading}
              onClick={() =>
                void (async () => {
                  let uids: number[] = [];
                  if (selectedMailRowIds.size > 0) {
                    uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
                  } else if (mailFolder === "trash" && selectedThread) {
                    uids = selectedThread.messages.map((m) => m.uid);
                  }
                  await permanentlyDeleteTrashUidsNow(uids);
                })()
              }
            >
              {mailActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={composeOpen}
        onOpenChange={(open) => {
          setComposeOpen(open);
          if (!open) setComposeAttachments([]);
        }}
      >
        <DialogContent
          className="flex max-h-[min(92vh,880px)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton
        >
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>Compose</DialogTitle>
            <DialogDescription>Send through your SMTP account saved in Settings.</DialogDescription>
          </DialogHeader>
          <EmailComposeForm
            to={composeTo}
            onToChange={setComposeTo}
            cc={composeCc}
            onCcChange={setComposeCc}
            subject={composeSubject}
            onSubjectChange={setComposeSubject}
            body={composeBody}
            onBodyChange={setComposeBody}
            attachments={composeAttachments}
            onAddAttachments={(files) => void addComposeAttachments(files)}
            onRemoveAttachment={removeComposeAttachment}
            disabled={inboxReadOnly}
            sending={sending}
            aiBusy={aiReplyGenerating}
            onImproveWithAi={() => void improviseComposeWithAi()}
            onGenerateAiDraft={() => void generateAiReply()}
            onSaveDraft={saveDraft}
            scheduleEnabled={composeScheduleEnabled}
            onScheduleEnabledChange={(checked) => {
              setComposeScheduleEnabled(checked);
              if (checked && !composeScheduledAt) setComposeScheduledAt(defaultScheduleDatetimeLocal());
            }}
            scheduledAt={composeScheduledAt}
            onScheduledAtChange={setComposeScheduledAt}
            minimumScheduledAt={defaultScheduleDatetimeLocal()}
            onSend={() => void handleSend()}
            onScheduleSend={() => void handleScheduleSend()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function InboxReadingToolbarExtras({
  messages,
  mailFolder,
  inboxReadOnly,
  blockedSenderDomains,
  onRequestBlockDomain,
}: {
  messages: MailInbound[];
  mailFolder: MailFolder;
  inboxReadOnly: boolean;
  blockedSenderDomains: string[];
  onRequestBlockDomain: (domain: string) => void;
}) {
  const messageUnsubKey = messages
    .map((m) => `${m.uid}:${m.listUnsubscribe ?? ""}:${m.bodyHtml?.length ?? 0}:${m.bodySynced}`)
    .join("|");
  const unsubscribeUrl = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const u = extractUnsubscribeUrl(messages[i]!);
      if (u) return u;
    }
    return null;
  }, [messages, messageUnsubKey]);

  const senderDomain =
    messages.length > 0 ? extractSenderDomain(messages[messages.length - 1]!.from) : "";
  const domainBlocked =
    !!senderDomain &&
    blockedSenderDomains
      .map(normalizeBlockedSenderDomain)
      .includes(normalizeBlockedSenderDomain(senderDomain));

  if (!unsubscribeUrl && (mailFolder !== "inbox" || inboxReadOnly || !senderDomain)) {
    return null;
  }

  return (
    <>
      {unsubscribeUrl ? (
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          nativeButton={false}
          render={
            <a href={unsubscribeUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Unsubscribe
            </a>
          }
        />
      ) : null}
      {mailFolder === "inbox" && !inboxReadOnly && senderDomain ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={domainBlocked}
          onClick={() => onRequestBlockDomain(senderDomain)}
        >
          <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {domainBlocked ? `Blocked (${senderDomain})` : `Block ${senderDomain}`}
        </Button>
      ) : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InboundAttachmentRow({ att }: { att: MailInboundAttachment }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-auto max-w-full justify-start gap-2 py-2 px-3"
      onClick={() => {
        if (!att.contentBase64) {
          toast.message("Cannot download in the browser", {
            description:
              "This file is larger than the inline limit or the message was truncated. Open the same message in Apple Mail or Outlook to download it, or ask your admin to raise the fetch size.",
          });
          return;
        }
        try {
          const bin = atob(att.contentBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: att.mimeType || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = att.filename || "attachment";
          a.click();
          URL.revokeObjectURL(url);
        } catch {
          toast.error("Could not prepare download");
        }
      }}
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-left text-xs font-medium">{att.filename}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{formatBytes(att.sizeBytes)}</span>
    </Button>
  );
}

function senderDisplayLabel(from: string): string {
  const angle = from.match(/^([^<]+)</);
  if (angle) return angle[1]!.trim().replace(/^["']|["']$/g, "");
  return from.trim();
}

function messagePreviewSnippet(m: MailInbound, maxLen = 180): string {
  const raw = (m.bodyText || m.preview || "").replace(/\s+/g, " ").trim();
  if (!raw) return "No preview";
  return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
}

function useInboundHtmlIframeHeight(html: string | undefined, srcDoc: string | undefined) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [heightPx, setHeightPx] = React.useState(360);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !srcDoc) return;

    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
        if (h && h > 0) {
          setHeightPx(Math.min(Math.max(h + 24, 320), 1400));
        }
      } catch {
        /* sandbox / cross-origin */
      }
    };

    iframe.addEventListener("load", measure);
    const t = window.setTimeout(measure, 120);
    return () => {
      iframe.removeEventListener("load", measure);
      window.clearTimeout(t);
    };
  }, [html, srcDoc]);

  return { iframeRef, heightPx };
}

type InboundMessageCardProps = {
  message: MailInbound;
  /** Use available column height for single-message reading. */
  fillHeight?: boolean;
  /** Hide header when embedded under a thread collapse row. */
  showHeader?: boolean;
  className?: string;
};

function InboundMessageCard({
  message: m,
  fillHeight = false,
  showHeader = true,
  className,
}: InboundMessageCardProps) {
  const [readerOpen, setReaderOpen] = React.useState(false);
  const html = m.bodyHtml?.trim();
  const srcDoc =
    html &&
    `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank" rel="noopener noreferrer"><style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.55; color: #fafafa; background: #09090b; margin: 12px; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      a { color: #93c5fd; }
      blockquote { border-left: 2px solid #3f3f46; margin: 0.5em 0; padding-left: 0.75em; color: #a1a1aa; }
    </style></head><body>${html}</body></html>`;
  const { iframeRef, heightPx } = useInboundHtmlIframeHeight(html, srcDoc || undefined);
  const textMinH = fillHeight ? "min-h-[min(70vh,720px)]" : "min-h-[200px]";

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card text-sm shadow-sm",
        fillHeight && "min-h-0 flex-1",
        className,
      )}
    >
      {showHeader ? (
        <div className="shrink-0 space-y-1 border-b border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{senderDisplayLabel(m.from)}</span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">{fmtRelative(m.date)}</span>
              <MailZoomButton onClick={() => setReaderOpen(true)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground break-all">{m.from}</p>
          {m.to ? <p className="text-[11px] text-muted-foreground">To: {m.to}</p> : null}
          {m.cc ? <p className="text-[11px] text-muted-foreground">Cc: {m.cc}</p> : null}
        </div>
      ) : (
        <div className="flex justify-end px-3 pt-2">
          <MailZoomButton onClick={() => setReaderOpen(true)} />
        </div>
      )}
      <div className={cn("flex flex-col gap-3 p-4", fillHeight && "min-h-0 flex-1", !showHeader && "pt-3")}>
        {m.attachments && m.attachments.length > 0 ? (
          <div className="shrink-0 space-y-1.5 rounded-md border border-border/60 bg-muted/10 p-2">
            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
              {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((att, idx) => (
                <InboundAttachmentRow key={`${m.uid}-${att.filename}-${idx}`} att={att} />
              ))}
            </div>
          </div>
        ) : null}
        {html && srcDoc ? (
          <iframe
            ref={iframeRef}
            title={`HTML: ${m.subject || "message"}`}
            className="w-full shrink-0 rounded-md border bg-background"
            style={{ height: fillHeight ? Math.max(heightPx, 480) : heightPx }}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={srcDoc}
          />
        ) : m.bodySynced === false && !m.bodyText?.trim() ? (
          <p className="text-xs text-muted-foreground">Loading full message…</p>
        ) : (
          <div
            className={cn(
              "whitespace-pre-wrap overflow-x-auto text-[13px] leading-relaxed rounded-md border bg-muted/5 p-4",
              textMinH,
              fillHeight && "flex-1",
            )}
          >
            {m.bodyText || m.preview}
          </div>
        )}
      </div>
      <MailReaderDialog
        open={readerOpen}
        onOpenChange={setReaderOpen}
        content={mailReaderContentFromInbound(m)}
      />
    </div>
  );
}

type ThreadInboundMessageProps = {
  message: MailInbound;
  expanded: boolean;
  collapsible: boolean;
  isLatest: boolean;
  onToggle: () => void;
};

function ThreadInboundMessage({
  message: m,
  expanded,
  collapsible,
  isLatest,
  onToggle,
}: ThreadInboundMessageProps) {
  if (!collapsible) {
    return <InboundMessageCard message={m} fillHeight className="min-h-0 flex-1" />;
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-colors",
        expanded ? "ring-1 ring-border" : "hover:bg-muted/15",
        isLatest && !expanded && "border-primary/30",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium truncate">{senderDisplayLabel(m.from)}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtRelative(m.date)}</span>
          </div>
          {!expanded ? (
            <p className="text-xs text-muted-foreground line-clamp-2">{messagePreviewSnippet(m)}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {isLatest ? "Latest in thread" : "Click header to collapse"}
            </p>
          )}
        </div>
        {!m.seen ? (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
        ) : null}
      </button>
      {expanded ? (
        <div className="border-t border-border/60">
          <InboundMessageCard
            message={m}
            showHeader={false}
            className="border-0 shadow-none rounded-none bg-transparent"
          />
        </div>
      ) : null}
    </div>
  );
}

function resolveContactForMailListRow(row: MailListRow, contacts: Contact[]): Contact | null {
  const matchInbound = (msg: MailInbound) => {
    const emails = collectMessageEmails(msg);
    return (
      contacts.find((contact) => {
        const owned = contactEmailSet(contact);
        for (const e of owned) {
          if (emails.has(e)) return true;
        }
        return false;
      }) ?? null
    );
  };

  if (row.thread) {
    for (let i = row.thread.messages.length - 1; i >= 0; i--) {
      const hit = matchInbound(row.thread.messages[i]!);
      if (hit) return hit;
    }
    return null;
  }

  const item = row.row;
  if ("scheduledAt" in item && "status" in item) {
    return null;
  }
  if ("sentAt" in item && !("date" in item)) {
    const emails = collectMessageEmails(item as MailDraft | MailSent);
    return (
      contacts.find((contact) => {
        const owned = contactEmailSet(contact);
        for (const e of owned) {
          if (emails.has(e)) return true;
        }
        return false;
      }) ?? null
    );
  }
  if ("date" in item && "uid" in item) {
    return matchInbound(item as MailInbound);
  }
  if ("updatedAt" in item) {
    const emails = collectMessageEmails(item as MailDraft | MailSent | MailInbound);
    return (
      contacts.find((contact) => {
        const owned = contactEmailSet(contact);
        for (const e of owned) {
          if (emails.has(e)) return true;
        }
        return false;
      }) ?? null
    );
  }
  return null;
}

function resolveLeadForMailListRow(
  row: MailListRow,
  mailboxId: string,
  linkedLeadByMessageId: Record<string, string>,
  leads: Lead[],
): Lead | null {
  const byId = (id: string) => leads.find((l) => l.id === id) ?? null;

  const matchInbound = (msg: MailInbound) => {
    const mid = `${mailboxId}:in:${msg.id}`;
    const manual = linkedLeadByMessageId[mid];
    if (manual) return byId(manual);
    const emails = collectMessageEmails(msg);
    return leads.find((lead) => lead.contactEmail && emails.has(lead.contactEmail.toLowerCase())) ?? null;
  };

  if (row.thread) {
    for (let i = row.thread.messages.length - 1; i >= 0; i--) {
      const hit = matchInbound(row.thread.messages[i]!);
      if (hit) return hit;
    }
    return null;
  }

  const item = row.row;
  if ("scheduledAt" in item && "status" in item) {
    return null;
  }
  if ("sentAt" in item && !("date" in item)) {
    const manual = linkedLeadByMessageId[item.id];
    if (manual) return byId(manual);
    const emails = collectMessageEmails(item as MailSent);
    return leads.find((lead) => lead.contactEmail && emails.has(lead.contactEmail.toLowerCase())) ?? null;
  }
  if ("date" in item && "uid" in item) {
    return matchInbound(item as MailInbound);
  }
  if ("updatedAt" in item) {
    const manual = linkedLeadByMessageId[item.id];
    if (manual) return byId(manual);
    const emails = collectMessageEmails(item as MailDraft);
    return leads.find((lead) => lead.contactEmail && emails.has(lead.contactEmail.toLowerCase())) ?? null;
  }
  return null;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectMessageEmails(message: MailDraft | MailSent | MailInbound) {
  const values = new Set<string>();
  if ("from" in message) {
    const from = extractReplyAddress(message.from);
    if (from) values.add(from.toLowerCase());
  }
  const toTokens = message.to.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const token of toTokens) values.add(token.toLowerCase());
  if ("cc" in message && typeof message.cc === "string" && message.cc) {
    const ccTokens = message.cc.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const token of ccTokens) values.add(token.toLowerCase());
  }
  return values;
}

function extractPrimaryEmailFromMessage(message: MailSent | MailInbound) {
  const emails = collectMessageEmails(message);
  return Array.from(emails)[0] ?? "";
}
