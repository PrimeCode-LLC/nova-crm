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
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isEmailAccountConfigured,
  getActiveMailbox,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import type { EmailMailboxSettings, MailDraft, MailInbound, MailSent } from "@/lib/email-account-types";
import {
  conversationSubject,
  groupInboundIntoThreads,
  type MailThread,
} from "@/lib/email/thread-inbound";
import {
  Mail,
  Loader2,
  PenLine,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  Search,
  ChevronDown,
} from "lucide-react";
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

type MailListRow = {
  id: string;
  title: string;
  subtitle: string;
  at: string;
  row: MailDraft | MailSent | MailInbound;
  muted?: boolean;
  thread?: MailThread;
};

function mailListRowMatchesSearch(row: MailListRow, q: string): boolean {
  if (!q) return true;
  const head = `${row.title}\n${row.subtitle}`.toLowerCase();
  if (head.includes(q)) return true;
  if (row.thread) {
    for (const m of row.thread.messages) {
      const t = [m.subject, m.from, m.to, m.preview, m.bodyText].filter(Boolean).join("\n").toLowerCase();
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

type MailFolder = "inbox" | "sent" | "drafts" | "trash";
type ImapListFolder = "inbox" | "trash";

/** Matches server-side IMAP list batching; older messages load via “Load more”. */
const INBOX_IMAP_PAGE_LIMIT = 800;

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { leads, isDemo, addAccount, addContact, addLead, currentUserId } = useWorkspace();

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

  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const setActiveMailbox = useEmailAccountStore((s) => s.setActiveMailbox);
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const trashInboundByMailbox = useEmailAccountStore((s) => s.trashInboundByMailbox);
  const setInbound = useEmailAccountStore((s) => s.setInbound);
  const appendInbound = useEmailAccountStore((s) => s.appendInbound);
  const setTrashInbound = useEmailAccountStore((s) => s.setTrashInbound);
  const mergeInboundBodies = useEmailAccountStore((s) => s.mergeInboundBodies);
  const mergeTrashBodies = useEmailAccountStore((s) => s.mergeTrashBodies);
  const removeInboundByUids = useEmailAccountStore((s) => s.removeInboundByUids);
  const moveInboundUidsToTrashLocal = useEmailAccountStore((s) => s.moveInboundUidsToTrashLocal);
  const removeTrashByUids = useEmailAccountStore((s) => s.removeTrashByUids);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const linkMessageToLead = useEmailAccountStore((s) => s.linkMessageToLead);
  const drafts = useEmailAccountStore((s) => s.drafts);
  const sent = useEmailAccountStore((s) => s.sent);
  const upsertDraft = useEmailAccountStore((s) => s.upsertDraft);
  const deleteDraft = useEmailAccountStore((s) => s.deleteDraft);
  const addSent = useEmailAccountStore((s) => s.addSent);
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const account = getActiveMailbox({ mailboxes, activeMailboxId });

  const [mailFolder, setMailFolder] = React.useState<MailFolder>("inbox");
  const [selectedThread, setSelectedThread] = React.useState<MailThread | null>(null);
  const [selectedMail, setSelectedMail] = React.useState<MailDraft | MailSent | MailInbound | null>(null);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeTo, setComposeTo] = React.useState("");
  const [composeSubject, setComposeSubject] = React.useState("");
  const [composeBody, setComposeBody] = React.useState("");
  const [composeDraftId, setComposeDraftId] = React.useState<string | undefined>();
  const [sending, setSending] = React.useState(false);

  const [inboundLoading, setInboundLoading] = React.useState(false);
  const [inboundLoadingMore, setInboundLoadingMore] = React.useState(false);
  const [trashLoading, setTrashLoading] = React.useState(false);
  /** Total messages in INBOX on server (from last IMAP list); may exceed loaded rows. */
  const [imapMailboxTotal, setImapMailboxTotal] = React.useState<number | null>(null);
  const [imapTrashTotal, setImapTrashTotal] = React.useState<number | null>(null);
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
  const [mailActionLoading, setMailActionLoading] = React.useState(false);

  const emailFolderSupportsImapList = mailFolder === "inbox" || mailFolder === "trash";
  const canUseTrashFeatures = isDemo || isImapInboxConfigured(account);

  React.useEffect(() => {
    setImapMailboxTotal(null);
    setImapTrashTotal(null);
  }, [account.id]);

  React.useEffect(() => {
    setSelectedThread((prev) => {
      if (!prev) return null;
      const threads = mailFolder === "trash" ? trashThreads : inboundThreads;
      return threads.find((t) => t.threadId === prev.threadId) ?? null;
    });
  }, [inboundThreads, trashThreads, mailFolder]);

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
          const res = await fetch("/api/email/imap-fetch-bodies", {
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
  ]);

  const fetchImapListFolder = React.useCallback(
    async (folder: ImapListFolder) => {
      if (isDemo) {
        if (folder === "inbox") {
          toast.message("Demo inbox", { description: "Sample threads only — no IMAP server is used." });
        }
        return;
      }
      const acct = getActiveMailbox(useEmailAccountStore.getState());
      if (!isImapInboxConfigured(acct)) {
        if (folder === "inbox") setInbound(acct.id, []);
        else setTrashInbound(acct.id, []);
        return;
      }
      if (folder === "inbox") setInboundLoading(true);
      else setTrashLoading(true);
      try {
        const res = await fetch("/api/email/imap-fetch", {
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
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          messages?: MailInbound[];
          mailboxTotal?: number;
        };
        if (!data.ok) {
          const err = data.error ?? "Unknown error from the mail server.";
          toast.error(folder === "inbox" ? "Couldn’t refresh mail" : "Couldn’t load Trash", {
            description: err.length > 400 ? `${err.slice(0, 400)}…` : err,
          });
          return;
        }
        const rows = Array.isArray(data.messages) ? data.messages : [];
        const total =
          typeof data.mailboxTotal === "number" && Number.isFinite(data.mailboxTotal) ? data.mailboxTotal : null;
        if (folder === "inbox") {
          setInbound(acct.id, rows);
          setImapMailboxTotal(total);
        } else {
          setTrashInbound(acct.id, rows);
          setImapTrashTotal(total);
        }
      } catch {
        toast.error("Could not reach the server");
      } finally {
        if (folder === "inbox") setInboundLoading(false);
        else setTrashLoading(false);
      }
    },
    [isDemo, setInbound, setTrashInbound],
  );

  const fetchInboundMail = React.useCallback(() => fetchImapListFolder("inbox"), [fetchImapListFolder]);
  const fetchTrashMail = React.useCallback(() => fetchImapListFolder("trash"), [fetchImapListFolder]);

  const loadMoreInboundMail = React.useCallback(async () => {
    if (isDemo || inboundLoadingMore) return;
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) return;
    const offset = useEmailAccountStore.getState().inboundByMailbox[acct.id]?.length ?? 0;
    if (imapMailboxTotal != null && offset >= imapMailboxTotal) return;

    setInboundLoadingMore(true);
    try {
      const res = await fetch("/api/email/imap-fetch", {
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
      const batch = Array.isArray(data.messages) ? data.messages : [];
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
  }, [isDemo, inboundLoadingMore, imapMailboxTotal, appendInbound]);

  /** Load INBOX or Trash from IMAP when the Email tab opens that folder (session-restored tab). */
  React.useEffect(() => {
    if (mailFolder !== "inbox" && mailFolder !== "trash") return;
    if (isDemo) return;
    if (!emailServerHydrated) return;

    const acct = getActiveMailbox(useEmailAccountStore.getState());
    if (!isImapInboxConfigured(acct)) {
      setInbound(acct.id, []);
      setTrashInbound(acct.id, []);
      return;
    }
    if (mailFolder === "inbox") void fetchImapListFolder("inbox");
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
  ]);

  function openCompose(preset?: Partial<MailDraft>) {
    setComposeTo(preset?.to ?? "");
    setComposeSubject(preset?.subject ?? "");
    setComposeBody(preset?.body ?? (account.signature ? `\n\n${account.signature}` : ""));
    setComposeDraftId(preset?.id);
    setComposeOpen(true);
  }

  async function handleSend() {
    if (!composeTo.trim()) {
      toast.error("Add a recipient");
      return;
    }
    if (isDemo) {
      setSending(true);
      try {
        addSent({
          mailboxId: account.id,
          from: account.emailAddress.trim() || "demo@nova.local",
          to: composeTo.trim(),
          subject: composeSubject.trim() || "(no subject)",
          body: composeBody,
        });
        if (composeDraftId) deleteDraft(composeDraftId);
        toast.success("Message saved to Sent (demo)", {
          description: "SMTP is not used in demo mode.",
        });
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
    setSending(true);
    try {
      const text = composeBody;
      const html = composeBody.split("\n").map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`).join("");
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: account.id,
          from: account.emailAddress,
          displayName: account.displayName,
          replyTo: account.replyTo,
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          text,
          html,
          smtp: {
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            user: account.smtp.user,
            pass: account.smtp.password,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "Send failed");
        return;
      }
      addSent({
        mailboxId: account.id,
        from: account.emailAddress,
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        body: composeBody,
      });
      if (composeDraftId) deleteDraft(composeDraftId);
      toast.success("Message sent");
      setComposeOpen(false);
      setMailFolder("sent");
      setSelectedMail(null);
      setSelectedThread(null);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSending(false);
    }
  }

  function saveDraft() {
    const id = upsertDraft({
      id: composeDraftId,
      mailboxId: account.id,
      to: composeTo,
      subject: composeSubject,
      body: composeBody,
    });
    setComposeDraftId(id);
    toast.success("Draft saved");
  }

  const toggleRowSelected = React.useCallback((rowId: string, checked: boolean) => {
    setSelectedMailRowIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  const clearMailRowSelection = React.useCallback(() => {
    setSelectedMailRowIds(new Set());
  }, []);

  const collectUidsFromMailRows = React.useCallback(
    (rowIds: Set<string>, rows: MailListRow[]) => {
      const uidSet = new Set<number>();
      for (const row of rows) {
        if (!rowIds.has(row.id)) continue;
        if (row.thread) for (const m of row.thread.messages) uidSet.add(m.uid);
        else if ("uid" in row.row) uidSet.add(row.row.uid);
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
      const res = await fetch("/api/email/imap-mutate", {
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

  async function permanentlyDeleteUidsOnServer(uids: number[]) {
    const acct = getActiveMailbox(useEmailAccountStore.getState());
    const CHUNK = 60;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const part = uids.slice(i, i + CHUNK);
      const res = await fetch("/api/email/imap-mutate", {
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

  const mailListRows: {
    id: string;
    title: string;
    subtitle: string;
    at: string;
    row: MailDraft | MailSent | MailInbound;
    muted?: boolean;
    thread?: MailThread;
  }[] = React.useMemo(() => {
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
      return sent.filter((m) => m.mailboxId === account.id).map((m) => ({
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
    return [];
  }, [mailFolder, sent, drafts, inboundThreads, trashThreads, account.id]);

  const visibleMailRows = React.useMemo(() => {
    const q = normalizeInboxSearch(listSearchQuery);
    return mailListRows.filter((row) => mailListRowMatchesSearch(row, q));
  }, [mailListRows, listSearchQuery]);

  const mailSearchActive = normalizeInboxSearch(listSearchQuery).length > 0;

  const selectAllVisibleMailRows = React.useCallback(() => {
    setSelectedMailRowIds(new Set(visibleMailRows.map((r) => r.id)));
  }, [visibleMailRows]);

  async function handleMoveInboxSelectionToTrash() {
    const uids = collectUidsFromMailRows(selectedMailRowIds, visibleMailRows);
    await moveInboxUidsToTrashNow(uids);
  }

  React.useEffect(() => {
    if (visibleMailRows.length === 0) {
      if (mailSearchActive) {
        setSelectedThread(null);
        setSelectedMail(null);
      }
      return;
    }
    if (selectedThread) {
      const ok = visibleMailRows.some((r) => r.thread?.threadId === selectedThread.threadId);
      if (ok) return;
      const pick = visibleMailRows[0]!;
      if (pick.thread) {
        setSelectedThread(pick.thread);
        setSelectedMail(null);
      } else {
        setSelectedThread(null);
        setSelectedMail(pick.row);
      }
      return;
    }
    if (selectedMail) {
      const ok = visibleMailRows.some((r) => !r.thread && r.row.id === selectedMail.id);
      if (ok) return;
      const pick = visibleMailRows[0]!;
      if (pick.thread) {
        setSelectedThread(pick.thread);
        setSelectedMail(null);
      } else {
        setSelectedThread(null);
        setSelectedMail(pick.row);
      }
    }
  }, [visibleMailRows, selectedThread, selectedMail, mailSearchActive]);

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
          (!isDemo && !isImapInboxConfigured(account) && (mailFolder === "inbox" || mailFolder === "trash"))
        }
        onClick={() => {
          if (mailFolder === "trash") void fetchTrashMail();
          else void fetchInboundMail();
        }}
        title={
          isDemo
            ? "Sample inbox — refresh shows this reminder"
            : isImapInboxConfigured(account)
              ? mailFolder === "trash"
                ? "Reload Trash from the server"
                : "Reload messages from the server"
              : "Configure IMAP in Email settings to refresh"
        }
      >
        {((mailFolder === "inbox" && inboundLoading) || (mailFolder === "trash" && trashLoading)) ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Refresh mail
      </Button>
      <Button size="sm" onClick={() => openCompose()}>
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

  function createLeadFromSelectedMessage() {
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
    addAccount({
      id: accountId,
      name: company.charAt(0).toUpperCase() + company.slice(1),
      domain,
      contactCount: 1,
      leadCount: 1,
      openDealValue: 0,
      ownerId: currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    addContact({
      id: contactId,
      accountId,
      firstName: name.split(" ")[0] ?? name,
      lastName: name.split(" ").slice(1).join(" "),
      fullName: name,
      email,
      ownerId: currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    addLead({
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const mid = "uid" in target ? `${account.id}:in:${target.id}` : target.id;
    linkMessageToLead(mid, leadId);
    toast.success("Lead created and linked");
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Threaded conversations (like Outlook) from the mailbox you connect in settings."
        actions={pageActions}
      />
      <PageBody className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden p-0">
        <div className="shrink-0 border-b px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
          {!isEmailAccountConfigured(account) && (
            <p className="text-[11px] text-muted-foreground">
              SMTP not fully configured — you can still compose drafts;{" "}
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
          <div className="ml-auto min-w-[220px]">
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

        <div className="flex min-h-0 flex-1 divide-x">
            <div className="w-40 shrink-0 flex flex-col border-r p-2 gap-1">
              {(
                [
                  { id: "inbox" as const, label: "Inbox" },
                  { id: "trash" as const, label: "Trash" },
                  { id: "sent" as const, label: "Sent" },
                  { id: "drafts" as const, label: "Drafts" },
                ] as const
              ).map((f) => (
                <Button
                  key={f.id}
                  variant={mailFolder === f.id ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start text-xs"
                  onClick={() => {
                    setMailFolder(f.id);
                    setSelectedMail(null);
                    setSelectedThread(null);
                    clearMailRowSelection();
                  }}
                >
                  {f.label}
                  {f.id === "inbox" && (
                    <Badge
                      variant="outline"
                      className="ml-auto h-5 max-w-[min(100%,5.75rem)] shrink-0 truncate px-1.5 text-[10px] font-normal"
                      title={mailboxDisplayLabel(account)}
                    >
                      {mailboxDisplayLabel(account)}
                    </Badge>
                  )}
                  {f.id === "trash" && trashInbound.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums">
                      {trashInbound.length}
                    </Badge>
                  )}
                  {f.id === "sent" && sent.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px]">
                      {sent.length}
                    </Badge>
                  )}
                  {f.id === "drafts" && drafts.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px]">
                      {drafts.length}
                    </Badge>
                  )}
                </Button>
              ))}
              <div className="mt-auto pt-2 border-t">
                <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => openCompose()}>
                  <PenLine className="h-3 w-3 mr-1" />
                  Compose
                </Button>
              </div>
            </div>

            <div className="w-full max-w-md flex flex-col border-r max-h-[calc(100vh-250px)] overflow-y-auto">
              <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground capitalize space-y-2">
                <div>{mailFolder}</div>
                {mailFolder === "inbox" &&
                  imapMailboxTotal != null &&
                  imapMailboxTotal > inbound.length && (
                    <div className="font-normal text-[10px] leading-snug normal-case">
                      Loaded newest {inbound.length} of {imapMailboxTotal} messages in INBOX
                    </div>
                  )}
                {mailFolder === "trash" &&
                  imapTrashTotal != null &&
                  imapTrashTotal > trashInbound.length && (
                    <div className="font-normal text-[10px] leading-snug normal-case">
                      Loaded newest {trashInbound.length} of {imapTrashTotal} messages in Trash
                    </div>
                  )}
                {canUseTrashFeatures && emailFolderSupportsImapList && (
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
                    )}
                  </div>
                )}
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
                  trashInbound.length === 0 &&
                  (isImapInboxConfigured(account) || isDemo) && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Trash is empty.</div>
                  )}
                {(mailFolder === "sent" || mailFolder === "drafts") && mailListRows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">Nothing here yet.</div>
                )}
                {mailSearchActive && mailListRows.length > 0 && visibleMailRows.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">No messages match your search.</div>
                )}
                {visibleMailRows.map((row) => {
                  const isRowSelected = row.thread
                    ? selectedThread?.threadId === row.thread.threadId
                    : selectedMail?.id === row.row.id && selectedThread == null;
                  const showSelect = canUseTrashFeatures && emailFolderSupportsImapList;
                  const bulkChecked = selectedMailRowIds.has(row.id);
                  return (
                    <div key={row.id} className="flex items-stretch gap-0 border-b border-border/60 last:border-b-0">
                      {showSelect ? (
                        <div
                          className="flex w-9 shrink-0 items-center justify-center border-r border-border/60 bg-muted/5"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          role="presentation"
                        >
                          <Checkbox
                            checked={bulkChecked}
                            onCheckedChange={(v) => toggleRowSelected(row.id, v === true)}
                            aria-label={row.thread ? "Select conversation" : "Select message"}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (row.thread) {
                            setSelectedThread(row.thread);
                            setSelectedMail(null);
                          } else {
                            setSelectedThread(null);
                            setSelectedMail(row.row);
                          }
                        }}
                        className={cn(
                          "min-w-0 flex-1 text-left px-3 py-2.5 hover:bg-muted/20 text-sm",
                          isRowSelected && "bg-muted/30",
                          row.muted && "opacity-80",
                        )}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div
                              className={cn(
                                "truncate",
                                !row.muted && mailFolder === "inbox" && "font-medium",
                              )}
                            >
                              {row.title}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
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
                        disabled={inboundLoading || inboundLoadingMore}
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
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 p-6">
              {(mailFolder === "inbox" || mailFolder === "trash") && selectedThread ? (
                <div className="space-y-4 max-w-2xl w-full">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{selectedThread.conversationSubject}</h3>
                      {selectedThread.messages.length > 1 ? (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {selectedThread.messages.length} messages
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Latest {fmtRelative(selectedThread.latest.date)}
                    </p>
                  </div>
                  <div className="space-y-3 max-h-[min(70vh,720px)] overflow-y-auto pr-1">
                    {selectedThread.messages.map((m) => (
                      <div key={m.uid} className="rounded-lg border bg-muted/10 p-4 text-sm space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2">
                          <span className="text-xs font-medium">{m.from}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {fmtRelative(m.date)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{m.subject || "(no subject)"}</p>
                        {m.bodySynced === false && !m.bodyText?.trim() ? (
                          <p className="text-xs text-muted-foreground">Loading full message…</p>
                        ) : (
                          <div className="whitespace-pre-wrap overflow-x-auto">{m.bodyText || m.preview}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5"
                      onClick={() => {
                        const latest = selectedThread.latest;
                        const addr = extractReplyAddress(latest.from);
                        if (!addr) {
                          toast.error("Could not read a reply address from this conversation.");
                          return;
                        }
                        const subj = conversationSubject(latest.subject ?? "");
                        const reSubj = subj.match(/^re:/i) ? subj : subj ? `Re: ${subj}` : "Re:";
                        openCompose({
                          to: addr,
                          subject: reSubj,
                          body: `\n\n---\nOn ${latest.date.slice(0, 10)}, ${latest.from} wrote:\n${(latest.bodyText || latest.preview || "").slice(0, 2000)}`,
                        });
                      }}
                    >
                      <Reply className="h-3.5 w-3.5" /> Reply
                    </Button>
                    {mailFolder === "inbox" && canUseTrashFeatures && (
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
                    {mailFolder === "trash" && canUseTrashFeatures && (
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
                    )}
                    {selectedLead ? (
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/leads/${selectedLead.id}?tab=emails`}>Open lead</Link>}
                      />
                    ) : (
                      <Button size="sm" variant="outline" onClick={createLeadFromSelectedMessage}>
                        Add to leads
                      </Button>
                    )}
                  </div>
                  {selectedLead ? (
                    <div className="rounded-lg border p-3 text-xs bg-muted/10">
                      Linked lead:{" "}
                      <Link className="text-primary hover:underline" href={`/leads/${selectedLead.id}?tab=emails`}>
                        {selectedLead.contactName} - {selectedLead.companyName}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : selectedMail ? (
                <div className="space-y-4 max-w-xl">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedMail.subject || "(no subject)"}</h3>
                    {"sentAt" in selectedMail ? (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">To: {selectedMail.to}</p>
                        <p className="text-xs text-muted-foreground">{fmtRelative(selectedMail.sentAt)}</p>
                      </>
                    ) : "updatedAt" in selectedMail ? (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">To: {selectedMail.to}</p>
                        <p className="text-xs text-muted-foreground">{fmtRelative(selectedMail.updatedAt)}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">From: {selectedMail.from}</p>
                        {selectedMail.to ? (
                          <p className="text-xs text-muted-foreground">To: {selectedMail.to}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">{fmtRelative(selectedMail.date)}</p>
                      </>
                    )}
                  </div>
                  {"sentAt" in selectedMail || "updatedAt" in selectedMail ? (
                    <div className="rounded-lg border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
                      {selectedMail.body}
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/10 p-4 text-sm whitespace-pre-wrap">
                      {selectedMail.bodyText}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {"sentAt" in selectedMail ? null : "updatedAt" in selectedMail ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            openCompose({
                              id: selectedMail.id,
                              to: selectedMail.to,
                              subject: selectedMail.subject,
                              body: selectedMail.body,
                            })
                          }
                        >
                          Edit & send
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            deleteDraft(selectedMail.id);
                            setSelectedMail(null);
                            toast.success("Draft deleted");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        onClick={() => {
                          const addr = extractReplyAddress(selectedMail.from);
                          if (!addr) {
                            toast.error("Could not read a reply address from this message.");
                            return;
                          }
                          const subj = selectedMail.subject?.trim();
                          const reSubj = subj?.match(/^re:/i) ? subj : subj ? `Re: ${subj}` : "Re:";
                          openCompose({
                            to: addr,
                            subject: reSubj,
                            body: `\n\n---\nOn ${selectedMail.date.slice(0, 10)}, ${selectedMail.from} wrote:\n${(selectedMail.bodyText || selectedMail.preview || "").slice(0, 2000)}`,
                          });
                        }}
                      >
                        <Reply className="h-3.5 w-3.5" /> Reply
                      </Button>
                    )}
                    {mailFolder === "inbox" && canUseTrashFeatures && "uid" in selectedMail && (
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
                    {mailFolder === "trash" && canUseTrashFeatures && "uid" in selectedMail && (
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
                    )}
                    {selectedLead ? (
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/leads/${selectedLead.id}?tab=emails`}>Open lead</Link>}
                      />
                    ) : (
                      !("updatedAt" in selectedMail) && (
                        <Button size="sm" variant="outline" onClick={createLeadFromSelectedMessage}>
                          Add to leads
                        </Button>
                      )
                    )}
                  </div>
                  {selectedLead ? (
                    <div className="rounded-lg border p-3 text-xs bg-muted/10">
                      Linked lead:{" "}
                      <Link className="text-primary hover:underline" href={`/leads/${selectedLead.id}?tab=emails`}>
                        {selectedLead.contactName} - {selectedLead.companyName}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={Mail}
                  title={
                    mailFolder === "inbox" || mailFolder === "trash"
                      ? "Select a conversation"
                      : "Select a message"
                  }
                  description={
                    mailFolder === "inbox"
                      ? isImapInboxConfigured(account) || isDemo
                        ? "Choose a thread from the list or refresh. Replies are grouped like Outlook when headers match."
                        : "Configure IMAP in Email settings, then open Inbox to load messages."
                      : mailFolder === "trash"
                        ? "Open Trash to review messages removed from your inbox. Deleting here removes them from the server permanently."
                        : "Pick an item from the list or compose a new message."
                  }
                />
              )}
            </div>
          </div>
      </PageBody>

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

      <Sheet open={composeOpen} onOpenChange={setComposeOpen}>
        <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col">
          <SheetHeader>
            <SheetTitle>Compose</SheetTitle>
            <SheetDescription>Send through your SMTP account saved in Settings.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                className="min-h-[200px] text-sm"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="flex-row flex-wrap gap-2 border-t">
            <Button variant="outline" size="sm" onClick={saveDraft}>
              Save draft
            </Button>
            <Button size="sm" className="gap-1.5" disabled={sending} onClick={() => void handleSend()}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractReplyAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare?.[0]?.trim() ?? "";
}

function collectMessageEmails(message: MailDraft | MailSent | MailInbound) {
  const values = new Set<string>();
  if ("from" in message) {
    const from = extractReplyAddress(message.from);
    if (from) values.add(from.toLowerCase());
  }
  const toTokens = message.to.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const token of toTokens) values.add(token.toLowerCase());
  return values;
}

function extractPrimaryEmailFromMessage(message: MailSent | MailInbound) {
  const emails = collectMessageEmails(message);
  return Array.from(emails)[0] ?? "";
}
