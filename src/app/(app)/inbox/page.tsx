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
import {
  buildDemoNotifications,
  type DemoNotification,
  type NotificationKind,
} from "@/lib/inbox-demo-notifications";
import {
  mergeNotificationSeed,
  useInboxNotificationOverrides,
} from "@/stores/inbox-notification-overrides-store";
import {
  isEmailAccountConfigured,
  isImapInboxConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import type { MailDraft, MailInbound, MailSent } from "@/lib/email-account-types";
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
} from "lucide-react";
import { toast } from "sonner";

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

export default function InboxPage() {
  const { leads, users, isDemo, demoPersonaId } = useWorkspace();
  const seed = React.useMemo(
    () => (isDemo ? buildDemoNotifications(leads, users, demoPersonaId) : []),
    [isDemo, leads, users, demoPersonaId],
  );
  const readIds = useInboxNotificationOverrides((s) => s.readIds);
  const unreadIds = useInboxNotificationOverrides((s) => s.unreadIds);
  const dismissedIds = useInboxNotificationOverrides((s) => s.dismissedIds);
  const markReadStore = useInboxNotificationOverrides((s) => s.markRead);
  const markUnreadStore = useInboxNotificationOverrides((s) => s.markUnread);
  const dismissStore = useInboxNotificationOverrides((s) => s.dismiss);
  const markAllReadStore = useInboxNotificationOverrides((s) => s.markAllRead);

  const notifications = React.useMemo(
    () => mergeNotificationSeed(seed, { readIds, unreadIds, dismissedIds }),
    [seed, readIds, unreadIds, dismissedIds],
  );

  const [selected, setSelected] = React.useState<DemoNotification | null>(null);
  const [tab, setTab] = React.useState<TabFilter>("all");
  const [inboxMode, setInboxMode] = React.useState<InboxMode>("workspace");

  const account = useEmailAccountStore((s) => s.account);
  const drafts = useEmailAccountStore((s) => s.drafts);
  const sent = useEmailAccountStore((s) => s.sent);
  const upsertDraft = useEmailAccountStore((s) => s.upsertDraft);
  const deleteDraft = useEmailAccountStore((s) => s.deleteDraft);
  const addSent = useEmailAccountStore((s) => s.addSent);

  const [mailFolder, setMailFolder] = React.useState<MailFolder>("inbox");
  const [selectedMail, setSelectedMail] = React.useState<MailDraft | MailSent | MailInbound | null>(null);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeTo, setComposeTo] = React.useState("");
  const [composeSubject, setComposeSubject] = React.useState("");
  const [composeBody, setComposeBody] = React.useState("");
  const [composeDraftId, setComposeDraftId] = React.useState<string | undefined>();
  const [sending, setSending] = React.useState(false);

  const [inbound, setInbound] = React.useState<MailInbound[]>([]);
  const [inboundLoading, setInboundLoading] = React.useState(false);

  async function fetchInboundMail() {
    if (!isImapInboxConfigured(account)) {
      setInbound([]);
      return;
    }
    setInboundLoading(true);
    try {
      const res = await fetch("/api/email/imap-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      setInbound(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setInboundLoading(false);
    }
  }

  React.useEffect(() => {
    if (inboxMode !== "email" || mailFolder !== "inbox") return;
    if (!isImapInboxConfigured(account)) {
      setInbound([]);
      return;
    }
    void fetchInboundMail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when switching back to IMAP inbox or credentials identity changes
  }, [inboxMode, mailFolder, account.enabled, account.imap.host, account.imap.user]);

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
    if (inboxMode !== "workspace") return;
    if (filtered.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && filtered.some((n) => n.id === prev.id)) return prev;
      return filtered[0] ?? null;
    });
  }, [filtered, inboxMode, tab]);

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
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        body: composeBody,
      });
      if (composeDraftId) deleteDraft(composeDraftId);
      toast.success("Message sent");
      setComposeOpen(false);
      setMailFolder("sent");
      setSelectedMail(null);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSending(false);
    }
  }

  function saveDraft() {
    const id = upsertDraft({
      id: composeDraftId,
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
  }[] = React.useMemo(() => {
    if (mailFolder === "inbox") {
      return inbound.map((m) => ({
        id: m.id,
        title: m.subject || "(no subject)",
        subtitle: m.from,
        at: m.date,
        row: m,
        muted: m.seen,
      }));
    }
    if (mailFolder === "sent") {
      return sent.map((m) => ({
        id: m.id,
        title: m.subject || "(no subject)",
        subtitle: m.to,
        at: m.sentAt,
        row: m,
      }));
    }
    if (mailFolder === "drafts") {
      return drafts.map((m) => ({
        id: m.id,
        title: m.subject || "(no subject)",
        subtitle: m.to || "No recipient",
        at: m.updatedAt,
        row: m,
      }));
    }
    return [];
  }, [mailFolder, sent, drafts, inbound]);

  const pageActions =
    inboxMode === "workspace" ? (
      notifications.length > 0 ? (
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
          disabled={inboundLoading || !isImapInboxConfigured(account)}
          onClick={() => void fetchInboundMail()}
          title={
            isImapInboxConfigured(account)
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

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          inboxMode === "workspace"
            ? "Mentions, assignments, and alerts across your pipeline."
            : "Send and receive mail in Nova using the mailbox you connect in settings."
        }
        actions={pageActions}
      />
      <PageBody className="p-0 flex-1">
        <div className="border-b px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
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
              Add IMAP host and username in{" "}
              <Link href="/settings?tab=email" className="text-primary underline-offset-2 hover:underline">
                Email settings
              </Link>{" "}
              to load incoming mail.
            </p>
          )}
        </div>

        {inboxMode === "workspace" ? (
          <div className="flex h-full min-h-0 divide-x">
            <div className="w-full max-w-md flex flex-col border-r">
              <div className="px-4 pt-3 pb-2 border-b">
                <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
                  <TabsList className="h-8 flex-wrap">
                    <TabsTrigger value="all" className="text-xs px-2.5 h-7">
                      All{" "}
                      {totalCount > 0 && (
                        <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                          {totalCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="unread" className="text-xs px-2.5 h-7">
                      Unread
                    </TabsTrigger>
                    <TabsTrigger value="mentions" className="text-xs px-2.5 h-7">
                      Mentions
                    </TabsTrigger>
                    <TabsTrigger value="assignments" className="text-xs px-2.5 h-7">
                      Assigned
                    </TabsTrigger>
                    <TabsTrigger value="alerts" className="text-xs px-2.5 h-7">
                      Alerts
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex-1 overflow-y-auto divide-y">
                {filtered.length === 0 && (
                  <div className="p-6 space-y-4">
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
                        "w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors",
                        selected?.id === n.id && "bg-muted/30",
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-8 w-8 rounded-full">
                          <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                            {senderInitials}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={cn(
                            "absolute -right-0.5 -bottom-0.5 h-4 w-4 rounded-full flex items-center justify-center",
                            KIND_COLORS[n.kind],
                          )}
                        >
                          <Icon className="h-2.5 w-2.5" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn("text-sm leading-snug", !n.read && "font-medium")}>{n.message}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{fmtRelative(n.timestamp)}</div>
                      </div>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-primary mt-1 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              {selected ? (
                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                        KIND_COLORS[selected.kind],
                      )}
                    >
                      {React.createElement(KIND_ICONS[selected.kind], {
                        className: "h-5 w-5",
                      })}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{selected.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtRelative(selected.timestamp)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Related to</div>
                    <Link
                      href={selected.targetHref}
                      className="text-sm font-medium hover:text-primary flex items-center gap-1.5"
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
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    icon={Inbox}
                    title="No notification selected"
                    description="Choose a notification on the left to view details."
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[420px] divide-x">
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
                  }}
                >
                  {f.label}
                  {f.id === "inbox" && inbound.length > 0 && (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px]">
                      {inbound.length}
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

            <div className="w-full max-w-md flex flex-col border-r">
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
                {mailListRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedMail(row.row)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 hover:bg-muted/20 text-sm",
                      selectedMail?.id === row.id && "bg-muted/30",
                      row.muted && "opacity-80",
                    )}
                  >
                    <div className={cn("truncate", !row.muted && mailFolder === "inbox" && "font-medium")}>
                      {row.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{fmtRelative(row.at)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 p-6">
              {selectedMail ? (
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
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={Mail}
                  title="Select a message"
                  description={
                    mailFolder === "inbox"
                      ? isImapInboxConfigured(account)
                        ? "Choose a message from the list or refresh to load the latest mail."
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
