"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { mockUsers } from "@/lib/mock-data";
import {
  Inbox,
  AtSign,
  UserPlus,
  CalendarClock,
  AlertTriangle,
  TrendingUp,
  Globe,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

type NotificationKind =
  | "mention"
  | "assignment"
  | "followup"
  | "idle"
  | "stage"
  | "form";

interface Notification {
  id: string;
  kind: NotificationKind;
  read: boolean;
  sender: string;
  message: string;
  target: string;
  targetHref: string;
  timestamp: string;
}

const now = new Date();
function ago(minutes: number) {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    kind: "mention",
    read: false,
    sender: "u-mgr-email",
    message: "@mentioned you in a note on Forge Robotics",
    target: "Forge Robotics",
    targetHref: "/leads/l-6",
    timestamp: ago(8),
  },
  {
    id: "n2",
    kind: "assignment",
    read: false,
    sender: "u-director",
    message: "Lead assigned to you: Jordan Harper at Northwind Logistics",
    target: "Jordan Harper",
    targetHref: "/leads/l-1",
    timestamp: ago(25),
  },
  {
    id: "n3",
    kind: "followup",
    read: false,
    sender: "u-sales-01",
    message: "Followup due today: Send proposal to Sofia Morales",
    target: "Sofia Morales",
    targetHref: "/followups",
    timestamp: ago(60),
  },
  {
    id: "n4",
    kind: "idle",
    read: false,
    sender: "u-director",
    message: "Idle lead alert: Orbit Analytics has been silent for 9 days",
    target: "Orbit Analytics",
    targetHref: "/leads/l-8",
    timestamp: ago(120),
  },
  {
    id: "n5",
    kind: "stage",
    read: true,
    sender: "u-sales-02",
    message: "Deal stage changed: Lattice Labs moved to Proposal",
    target: "Lattice Labs",
    targetHref: "/deals",
    timestamp: ago(180),
  },
  {
    id: "n6",
    kind: "form",
    read: true,
    sender: "u-tl-inbound",
    message: "New website form submission from Beacon Health",
    target: "Beacon Health",
    targetHref: "/leads/l-4",
    timestamp: ago(240),
  },
  {
    id: "n7",
    kind: "mention",
    read: false,
    sender: "u-sales-03",
    message: "@mentioned you: 'Can you review the Upwork proposal? @ali'",
    target: "Bilal Farooq",
    targetHref: "/leads/l-15",
    timestamp: ago(300),
  },
  {
    id: "n8",
    kind: "assignment",
    read: true,
    sender: "u-mgr-upwork",
    message: "Lead reassigned from Zara to you: Meridian Capital",
    target: "Meridian Capital",
    targetHref: "/leads/l-7",
    timestamp: ago(600),
  },
  {
    id: "n9",
    kind: "followup",
    read: true,
    sender: "u-sales-01",
    message: "Overdue followup: Follow up with Priya Desai (3 days past due)",
    target: "Priya Desai",
    targetHref: "/followups",
    timestamp: ago(1440),
  },
  {
    id: "n10",
    kind: "idle",
    read: true,
    sender: "u-director",
    message: "Idle alert: Aurora Games, 12 days since last touch",
    target: "Aurora Games",
    targetHref: "/leads/l-10",
    timestamp: ago(2880),
  },
];

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
  assignment: "bg-sky-500/10 text-sky-400",
  followup: "bg-amber-500/10 text-amber-400",
  idle: "bg-rose-500/10 text-rose-400",
  stage: "bg-emerald-500/10 text-emerald-400",
  form: "bg-violet-500/10 text-violet-400",
};

type TabFilter = "all" | "unread" | "mentions" | "assignments" | "alerts";

export default function InboxPage() {
  const [notifications, setNotifications] = React.useState(MOCK_NOTIFICATIONS);
  const [selected, setSelected] = React.useState<Notification | null>(null);
  const [tab, setTab] = React.useState<TabFilter>("all");

  const filtered = notifications.filter((n) => {
    if (tab === "unread") return !n.read;
    if (tab === "mentions") return n.kind === "mention";
    if (tab === "assignments") return n.kind === "assignment";
    if (tab === "alerts") return n.kind === "idle" || n.kind === "followup";
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  }

  function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Mentions, assignments, and alerts across your pipeline."
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          ) : undefined
        }
      />
      <PageBody className="p-0 flex-1">
        <div className="flex h-full min-h-0 divide-x">
          {/* Left: list */}
          <div className="w-full max-w-md flex flex-col border-r">
            <div className="px-4 pt-3 pb-2 border-b">
              <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-2.5 h-7">
                    All{" "}
                    {unreadCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="unread" className="text-xs px-2.5 h-7">Unread</TabsTrigger>
                  <TabsTrigger value="mentions" className="text-xs px-2.5 h-7">Mentions</TabsTrigger>
                  <TabsTrigger value="assignments" className="text-xs px-2.5 h-7">Assigned</TabsTrigger>
                  <TabsTrigger value="alerts" className="text-xs px-2.5 h-7">Alerts</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {filtered.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No notifications here.
                </div>
              )}
              {filtered.map((n) => {
                const Icon = KIND_ICONS[n.kind];
                const sender = mockUsers.find((u) => u.id === n.sender);
                const senderInitials = sender?.displayName
                  .split(" ")
                  .map((x) => x[0])
                  .join("")
                  .slice(0, 2) ?? "?";
                return (
                  <button
                    key={n.id}
                    onClick={() => { setSelected(n); markRead(n.id); }}
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
                      <div className={cn("absolute -right-0.5 -bottom-0.5 h-4 w-4 rounded-full flex items-center justify-center", KIND_COLORS[n.kind])}>
                        <Icon className="h-2.5 w-2.5" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm leading-snug", !n.read && "font-medium")}>
                        {n.message}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtRelative(n.timestamp)}
                      </div>
                    </div>
                    {!n.read && (
                      <span className="h-2 w-2 rounded-full bg-primary mt-1 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 flex flex-col">
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtRelative(selected.timestamp)}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Related to
                  </div>
                  <Link
                    href={selected.targetHref}
                    className="text-sm font-medium hover:text-primary flex items-center gap-1.5"
                  >
                    {selected.target}
                    <span className="text-xs text-muted-foreground">→ View record</span>
                  </Link>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toast.success("Marked as read")}
                  >
                    Mark read
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={Inbox}
                  title="No notification selected"
                  description="Click a notification on the left to view details."
                />
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
