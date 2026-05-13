"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { type DemoNotification, type NotificationKind } from "@/lib/inbox-demo-notifications";
import { useInboxNotificationOverrides } from "@/stores/inbox-notification-overrides-store";
import { useWorkspaceInboxNotifications } from "@/hooks/use-workspace-inbox-notifications";
import {
  Inbox,
  AtSign,
  UserPlus,
  CalendarClock,
  AlertTriangle,
  TrendingUp,
  Globe,
  Search,
  CheckCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/lib/types";

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

function normalizeListSearch(raw: string): string {
  return raw.trim().toLowerCase();
}

function notificationMatchesSearch(n: DemoNotification, q: string, users: User[]): boolean {
  if (!q) return true;
  const sender = users.find((u) => u.id === n.sender);
  const senderLabel = (sender?.displayName ?? "").toLowerCase();
  const blob = [n.message, n.target, senderLabel].join("\n").toLowerCase();
  return blob.includes(q);
}

type TabFilter = "all" | "unread" | "mentions" | "assignments" | "alerts";

export function WorkspaceNotificationsView() {
  const { users, isDemo } = useWorkspace();
  const { notifications } = useWorkspaceInboxNotifications();
  const markReadStore = useInboxNotificationOverrides((s) => s.markRead);
  const markUnreadStore = useInboxNotificationOverrides((s) => s.markUnread);
  const dismissStore = useInboxNotificationOverrides((s) => s.dismiss);
  const markAllReadStore = useInboxNotificationOverrides((s) => s.markAllRead);

  const [selected, setSelected] = React.useState<DemoNotification | null>(null);
  const [tab, setTab] = React.useState<TabFilter>("all");
  const [listSearchQuery, setListSearchQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = normalizeListSearch(listSearchQuery);
    return notifications
      .filter((n) => {
        if (tab === "unread") return !n.read;
        if (tab === "mentions") return n.kind === "mention";
        if (tab === "assignments") return n.kind === "assignment";
        if (tab === "alerts") return n.kind === "idle" || n.kind === "followup";
        return true;
      })
      .filter((n) => notificationMatchesSearch(n, q, users));
  }, [notifications, tab, listSearchQuery, users]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const totalCount = notifications.length;

  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && filtered.some((n) => n.id === prev.id)) return prev;
      return filtered[0] ?? null;
    });
  }, [filtered]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end border-b px-4 py-2">
        {notifications.length > 0 ? (
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        ) : null}
      </div>

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
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={listSearchQuery}
                onChange={(e) => setListSearchQuery(e.target.value)}
                placeholder="Search notifications…"
                className="h-8 pl-8 text-xs"
                aria-label="Search notifications"
              />
            </div>
          </div>
          <div className="flex-1 divide-y overflow-y-auto">
            {filtered.length === 0 && (
              <div className="space-y-4 p-6">
                <p className="text-center text-sm text-muted-foreground">
                  {normalizeListSearch(listSearchQuery)
                    ? "No notifications match your search."
                    : "No notifications here."}
                </p>
                {!isDemo && !normalizeListSearch(listSearchQuery) && (
                  <WorkspaceEmptyHint title="No workspace notifications yet" />
                )}
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
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
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
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Related to</div>
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
    </div>
  );
}
