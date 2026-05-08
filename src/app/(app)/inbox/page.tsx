"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { type DemoNotification, type NotificationKind } from "@/lib/inbox-demo-notifications";
import { useInboxNotificationOverrides } from "@/stores/inbox-notification-overrides-store";
import { useWorkspaceInboxNotifications } from "@/hooks/use-workspace-inbox-notifications";
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
  Inbox,
  AtSign,
  UserPlus,
  CalendarClock,
  AlertTriangle,
  TrendingUp,
  Globe,
  CheckCheck,
  Bell,
  Mail,
  Loader2,
  PenLine,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  MessagesSquare,
} from "lucide-react";
import { toast } from "sonner";
import { WorkspaceTeamChatPanel } from "@/components/inbox/workspace-team-chat-panel";

const KIND_ICONS: Record<NotificationKind, React.ElementType> = {
  mention: AtSign,
  assignment: UserPlus,
  followup: CalendarClock,
  idle: AlertTriangle,
  stage: TrendingUp,
  form: Globe,
};

const KIND_COLORS: Record<NotificationKind, string> = {
  mention: "bg-indigo-500/10 text-indigo-400",
  assignment: "bg-info/10 text-info",
  followup: "bg-warning/10 text-warning",
  idle: "bg-destructive/10 text-destructive",
  stage: "bg-success/10 text-success",
  form: "bg-violet-500/10 text-violet-400",
};

type TabFilter = "all" | "unread" | "mentions" | "assignments" | "alerts";
type InboxMode = "workspace" | "email";
type MailFolder = "inbox" | "sent" | "drafts";
type WorkspaceFeedTab = "activity" | "team_chat";

export default function InboxPage() {
  const {
    leads,
    users,
    isDemo,
    addAccount,
    addContact,
    addLead,
    currentUserId,
    organizationId,
  } = useWorkspace();
  const { notifications, inboxHydrated } = useWorkspaceInboxNotifications();
  const markReadStore = useInboxNotificationOverrides((s) => s.markRead);
  const markUnreadStore = useInboxNotificationOverrides((s) => s.markUnread);
  const dismissStore = useInboxNotificationOverrides((s) => s.dismiss);
  const markAllReadStore = useInboxNotificationOverrides((s) => s.markAllRead);

  const [selected, setSelected] = React.useState<DemoNotification | null>(null);
  const [tab, setTab] = React.useState<TabFilter>("all");
  const [inboxMode, setInboxMode] = React.useState<InboxMode>("workspace");
  const [workspaceFeedTab, setWorkspaceFeedTab] = React.useState<WorkspaceFeedTab>("activity");

  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const setActiveMailbox = useEmailAccountStore((s) => s.setActiveMailbox);
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const setInbound = useEmailAccountStore((s) => s.setInbound);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const linkMessageToLead = useEmailAccountStore((s) => s.linkMessageToLead);
  const drafts = useEmailAccountStore((s) => s.drafts);
  const sent = useEmailAccountStore((s) => s.sent);
  const upsertDraft = useEmailAccountStore((s) => s.upsertDraft);
  const deleteDraft = useEmailAccountStore((s) => s.deleteDraft);
  const addSent = useEmailAccountStore((s) => s.addSent);
  const account = getActiveMailbox({ mailboxes, activeMailboxId });
  const mailboxTriggerLabel = mailboxSelectLabel(account);

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
  const inbound = inboundByMailbox[account.id] ?? [];
  const inboundThreads = React.useMemo(() => groupInboundIntoThreads(inbound), [inbound]);

  React.useEffect(() => {
    setSelectedThread((prev) => {
      if (!prev) return null;
      return inboundThreads.find((t) => t.threadId === prev.threadId) ?? null;
    });
  }, [inboundThreads]);

  async function fetchInboundMail() {
    if (isDemo) {
      toast.message("Demo inbox", { description: "Sample threads only — no IMAP server is used." });
      return;
    }
    if (!isImapInboxConfigured(account)) {
      setInbound(account.id, []);
      return;
    }
    setInboundLoading(true);
    try {
      const res = await fetch("/api/email/imap-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: account.id,
          limit: 50,
          imap: {
            host: account.imap.host,
            port: account.imap.port,
            secure: account.imap.secure,
            user: account.imap.user,
            pass: account.imap.password,
          },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        messages?: MailInbound[];
      };
      if (!data.ok) {
        toast.error("Couldn’t refresh mail", {
          description: data.error ?? "Unknown error from the mail server.",
        });
        return;
      }
      setInbound(account.id, Array.isArray(data.messages) ? data.messages : []);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setInboundLoading(false);
    }
  }

  React.useEffect(() => {
    if (inboxMode !== "email" || mailFolder !== "inbox") return;
    if (isDemo) return;
    if (!isImapInboxConfigured(account)) {
      setInbound(account.id, []);
      return;
    }
    void fetchInboundMail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when switching back to IMAP inbox or credentials identity changes
  }, [inboxMode, mailFolder, account.id, account.enabled, account.imap.host, account.imap.user, isDemo]);

  const filtered = notifications.filter((n) => {
    if (tab === "unread") return !n.read;
    if (tab === "mentions") return n.kind === "mention";
    if (tab === "assignments") return n.kind === "assignment";
    if (tab === "alerts") return n.kind === "idle" || n.kind === "followup";
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const totalCount = notifications.length;

  React.useEffect(() => {
    if (inboxMode !== "workspace" || workspaceFeedTab !== "activity") return;
    if (filtered.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && filtered.some((n) => n.id === prev.id)) return prev;
      return filtered[0] ?? null;
    });
  }, [filtered, inboxMode, tab, workspaceFeedTab]);

  function markAllRead() {
    markAllReadStore(notifications.map((n) => n.id));
    toast.success("All notifications marked as read");
  }

  function markReadSelected() {
    if (!selected) return;
    markReadStore(selected.id);
    toast.success("Marked as read");
  }

  function dismissSelected() {
    if (!selected) return;
    dismissStore(selected.id);
    setSelected(null);
    toast.success("Dismissed");
  }

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
  }, [mailFolder, sent, drafts, inboundThreads, account.id]);

  const pageActions =
    inboxMode === "workspace" ? (
      workspaceFeedTab === "activity" && notifications.length > 0 ? (
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
        </Button>
      ) : undefined
    ) : (
      <div className="flex gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={inboundLoading || (!isDemo && !isImapInboxConfigured(account))}
          onClick={() => void fetchInboundMail()}
          title={
            isDemo
              ? "Sample inbox — refresh shows this reminder"
              : isImapInboxConfigured(account)
                ? "Reload messages from the server"
                : "Configure IMAP in Email settings to refresh"
          }
        >
          {inboundLoading ? (
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

    if (mailFolder === "inbox" && selectedThread) {
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
      mailFolder === "inbox" && selectedThread ? selectedThread.latest : selectedMail;
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
        description={
          inboxMode === "workspace"
            ? workspaceFeedTab === "team_chat"
              ? "Channels and direct messages for your organization — like Slack, inside your CRM."
              : "Mentions, assignments, and alerts across your pipeline."
            : "Threaded conversations (like Outlook) from the mailbox you connect in settings."
        }
        actions={pageActions}
      />
      <PageBody className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden p-0">
        <div className="shrink-0 border-b px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
          <Tabs value={inboxMode} onValueChange={(v) => setInboxMode(v as InboxMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="workspace" className="text-xs px-3 h-7 gap-1.5">
                <Bell className="h-3 w-3" />
                Workspace
              </TabsTrigger>
              <TabsTrigger value="email" className="text-xs px-3 h-7 gap-1.5">
                <Mail className="h-3 w-3" />
                Email
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {inboxMode === "email" && !isEmailAccountConfigured(account) && (
            <p className="text-[11px] text-muted-foreground">
              SMTP not fully configured — you can still compose drafts;{" "}
              <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                open Email settings
              </Link>{" "}
              to send.
            </p>
          )}
          {inboxMode === "email" && isEmailAccountConfigured(account) && !isImapInboxConfigured(account) && (
            <p className="text-[11px] text-muted-foreground">
              Add IMAP host in{" "}
              <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                Email settings
              </Link>{" "}
              to load incoming mail.
            </p>
          )}
          {inboxMode === "email" && (
            <div className="ml-auto min-w-[220px]">
              <Select
                value={account.id}
                onValueChange={(v) => {
                  if (v) setActiveMailbox(v);
                }}
              >
                <SelectTrigger className="h-8 min-w-[200px] max-w-[min(100%,280px)]">
                  <SelectValue placeholder="Select mailbox">
                    <span className="truncate">{mailboxTriggerLabel}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {mailboxes.map((mb) => (
                    <SelectItem key={mb.id} value={mb.id}>
                      {mb.label?.trim() || "Mailbox"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {inboxMode === "workspace" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b px-4 pt-2">
              <Tabs value={workspaceFeedTab} onValueChange={(v) => setWorkspaceFeedTab(v as WorkspaceFeedTab)}>
                <TabsList className="h-8">
                  <TabsTrigger value="activity" className="text-xs px-3 h-7 gap-1.5">
                    <Bell className="h-3 w-3" />
                    Activity
                  </TabsTrigger>
                  <TabsTrigger value="team_chat" className="text-xs px-3 h-7 gap-1.5">
                    <MessagesSquare className="h-3 w-3" />
                    Team chat
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {workspaceFeedTab === "team_chat" ? (
              <WorkspaceTeamChatPanel
                users={users}
                currentUserId={currentUserId}
                isDemo={isDemo}
                organizationId={organizationId}
              />
            ) : (
              <div className="flex min-h-0 flex-1 divide-x">
                <div className="flex w-full max-w-md flex-col border-r">
                  <div className="border-b px-4 pt-3 pb-2">
                    <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
                      <TabsList className="h-8 flex-wrap">
                        <TabsTrigger value="all" className="h-7 px-2.5 text-xs">
                          All{" "}
                          {totalCount > 0 && (
                            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                              {totalCount}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger value="unread" className="h-7 px-2.5 text-xs">
                          Unread
                        </TabsTrigger>
                        <TabsTrigger value="mentions" className="h-7 px-2.5 text-xs">
                          Mentions
                        </TabsTrigger>
                        <TabsTrigger value="assignments" className="h-7 px-2.5 text-xs">
                          Assigned
                        </TabsTrigger>
                        <TabsTrigger value="alerts" className="h-7 px-2.5 text-xs">
                          Alerts
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="flex-1 divide-y overflow-y-auto">
                    {!inboxHydrated ? (
                      <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        Loading notifications…
                      </div>
                    ) : (
                      <>
                        {filtered.length === 0 && (
                          <div className="space-y-4 p-6">
                            <p className="text-center text-sm text-muted-foreground">No notifications here.</p>
                            {!isDemo && <WorkspaceEmptyHint title="Inbox is empty in workspace mode" />}
                          </div>
                        )}
                        {filtered.map((n) => {
                      const Icon = KIND_ICONS[n.kind];
                      const sender = users.find((u) => u.id === n.sender);
                      const senderInitials =
                        sender?.displayName
                          .split(" ")
                          .map((x) => x[0])
                          .join("")
                          .slice(0, 2) ?? "?";
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => setSelected(n)}
                          className={cn(
                            "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20",
                            selected?.id === n.id && "bg-muted/30",
                          )}
                        >
                          <div className="relative shrink-0">
                            <Avatar className="h-8 w-8 rounded-full">
                              <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                                {senderInitials}
                              </AvatarFallback>
                            </Avatar>
                            <div
                              className={cn(
                                "absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full",
                                KIND_COLORS[n.kind],
                              )}
                            >
                              <Icon className="h-2.5 w-2.5" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={cn("text-sm leading-snug", !n.read && "font-medium")}>{n.message}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtRelative(n.timestamp)}</div>
                          </div>
                          {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        </button>
                      );
                    })}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  {!inboxHydrated ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      Loading…
                    </div>
                  ) : selected ? (
                    <div className="space-y-4 p-6">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                            KIND_COLORS[selected.kind],
                          )}
                        >
                          {React.createElement(KIND_ICONS[selected.kind], {
                            className: "h-5 w-5",
                          })}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{selected.message}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{fmtRelative(selected.timestamp)}</p>
                        </div>
                      </div>

                      <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Related to
                        </div>
                        <Link
                          href={selected.targetHref}
                          className="flex items-center gap-1.5 text-sm font-medium hover:text-primary"
                        >
                          {selected.target}
                          <span className="text-xs text-muted-foreground">→ View record</span>
                        </Link>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={selected.read} onClick={markReadSelected}>
                          Mark read
                        </Button>
                        {!selected.read && (
                          <Button size="sm" variant="ghost" onClick={() => markUnreadStore(selected.id)}>
                            Mark unread
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={dismissSelected}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <EmptyState
                        icon={Inbox}
                        title="No notification selected"
                        description="Choose a notification on the left to view details."
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 divide-x">
            <div className="w-40 shrink-0 flex flex-col border-r p-2 gap-1">
              {(
                [
                  { id: "inbox" as const, label: "Inbox" },
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
                  }}
                >
                  {f.label}
                  {f.id === "inbox" && inboundThreads.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px]">
                      {inboundThreads.length}
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
              <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground capitalize">{mailFolder}</div>
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
                {(mailFolder !== "inbox" || isImapInboxConfigured(account)) &&
                  mailListRows.length === 0 &&
                  !(mailFolder === "inbox" && inboundLoading) &&
                  mailFolder !== "inbox" && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Nothing here yet.</div>
                  )}
                {mailListRows.map((row) => {
                  const isRowSelected = row.thread
                    ? selectedThread?.threadId === row.thread.threadId
                    : selectedMail?.id === row.row.id && selectedThread == null;
                  return (
                    <button
                      key={row.id}
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
                        "w-full text-left px-3 py-2.5 hover:bg-muted/20 text-sm",
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
                  );
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 p-6">
              {mailFolder === "inbox" && selectedThread ? (
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
                        <div className="whitespace-pre-wrap overflow-x-auto">{m.bodyText}</div>
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
                          body: `\n\n---\nOn ${latest.date.slice(0, 10)}, ${latest.from} wrote:\n${latest.bodyText.slice(0, 2000)}`,
                        });
                      }}
                    >
                      <Reply className="h-3.5 w-3.5" /> Reply
                    </Button>
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
                            body: `\n\n---\nOn ${selectedMail.date.slice(0, 10)}, ${selectedMail.from} wrote:\n${selectedMail.bodyText.slice(0, 2000)}`,
                          });
                        }}
                      >
                        <Reply className="h-3.5 w-3.5" /> Reply
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
                  title={mailFolder === "inbox" ? "Select a conversation" : "Select a message"}
                  description={
                    mailFolder === "inbox"
                      ? isImapInboxConfigured(account)
                        ? "Choose a thread from the list or refresh. Replies are grouped like Outlook when headers match."
                        : "Configure IMAP in Email settings, then open Inbox to load messages."
                      : "Pick an item from the list or compose a new message."
                  }
                />
              )}
            </div>
          </div>
        )}
      </PageBody>

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

function mailboxSelectLabel(mb: EmailMailboxSettings): string {
  return mb.label?.trim() || "Mailbox";
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
