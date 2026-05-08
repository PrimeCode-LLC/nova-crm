"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Command as CommandIcon, Search } from "lucide-react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { GlobalCommandMenu } from "./global-command";
import { QuickAddButton } from "./app-sidebar";
import { WorkspaceModeToggle } from "./workspace-mode-toggle";
import { useInboxNotificationOverrides } from "@/stores/inbox-notification-overrides-store";
import { useWorkspaceInboxNotifications } from "@/hooks/use-workspace-inbox-notifications";
import { cn } from "@/lib/utils";

function toLabel(segment: string) {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function shortRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function AppTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const { notifications: mergedNotifications, inboxHydrated } = useWorkspaceInboxNotifications();
  const markRead = useInboxNotificationOverrides((s) => s.markRead);

  const bellUnread = mergedNotifications.filter((n) => !n.read).length;

  const sortedForMenu = React.useMemo(() => {
    return [...mergedNotifications].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [mergedNotifications]);

  const segments = pathname.split("/").filter(Boolean);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {segments.length === 0 ? (
              <BreadcrumbItem>
                <BreadcrumbPage>Home</BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              segments.map((seg, i) => {
                const href = "/" + segments.slice(0, i + 1).join("/");
                const isLast = i === segments.length - 1;
                return (
                  <React.Fragment key={href}>
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{toLabel(seg)}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink render={<Link href={href}>{toLabel(seg)}</Link>} />
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator />}
                  </React.Fragment>
                );
              })
            )}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-2">
          <WorkspaceModeToggle />
          <Button
            variant="outline"
            size="icon-sm"
            className="text-muted-foreground md:hidden"
            aria-label="Open search"
            onClick={() => setCmdOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground w-60 justify-between px-3 hidden md:flex"
            onClick={() => setCmdOpen(true)}
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              <span className="text-xs">Search anything…</span>
            </span>
            <kbd className="pointer-events-none ml-auto inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
              <CommandIcon className="h-3 w-3" />K
            </kbd>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative",
                    bellUnread > 0 && "text-primary hover:bg-primary/10 hover:text-primary",
                  )}
                  aria-label={
                    bellUnread > 0 ? `Notifications, ${bellUnread} unread` : "Notifications, none unread"
                  }
                >
                  <Bell className="h-4 w-4" aria-hidden />
                  {bellUnread > 0 && (
                    <Badge className="absolute -right-0.5 -top-0.5 min-h-4 min-w-4 rounded-full border-2 border-background px-1 py-0 text-[10px] tabular-nums leading-none">
                      {bellUnread > 99 ? "99+" : bellUnread}
                    </Badge>
                  )}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="font-semibold">Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!inboxHydrated ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">Loading…</div>
              ) : sortedForMenu.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  You&apos;re all caught up. Turn on Demo in the toolbar for sample alerts, or open Notifications when
                  you have tasks assigned to you.
                </div>
              ) : (
                sortedForMenu.slice(0, 8).map((n) => (
                  <DropdownMenuItem
                    key={n.id}
                    className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
                    onSelect={() => {
                      markRead(n.id);
                      router.push(n.targetHref);
                    }}
                  >
                    <span className="text-xs font-medium leading-tight text-foreground line-clamp-2">
                      {n.message}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {shortRelativeTime(n.timestamp)}
                      {!n.read ? " · Unread" : ""}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="justify-center font-medium text-primary"
                onSelect={() => router.push("/notifications")}
              >
                View all notifications
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <QuickAddButton />
        </div>
      </header>
      <GlobalCommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
