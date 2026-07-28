"use client";

import * as React from "react";
import dynamic from "next/dynamic";
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
  DropdownMenuGroup,
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
import { QuickAddButton } from "./app-sidebar";
import { WorkspaceModeToggle } from "./workspace-mode-toggle";
import { OrgTimezoneClock } from "./org-timezone-clock";
import { useWorkspaceInboxNotifications } from "@/hooks/use-workspace-inbox-notifications";
import { useTeamChatUnread } from "@/components/providers/team-chat-unread-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { cn } from "@/lib/utils";

const GlobalCommandMenu = dynamic(
  () => import("./global-command").then((m) => ({ default: m.GlobalCommandMenu })),
  { ssr: false },
);

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
  const { getLeadById } = useWorkspace();
  const { notifications: mergedNotifications, markRead } = useWorkspaceInboxNotifications();
  const { teamChatUnreadTotal } = useTeamChatUnread();

  const bellUnread =
    mergedNotifications.filter((n) => !n.read).length + teamChatUnreadTotal;

  const sortedForMenu = React.useMemo(() => {
    return [...mergedNotifications].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [mergedNotifications]);

  const segments = pathname.split("/").filter(Boolean);
  const leadDetailId =
    segments.length === 2 && segments[0] === "leads" ? segments[1] : undefined;
  const detailLead = leadDetailId ? getLeadById(leadDetailId) : undefined;
  const detailIsProspect = detailLead?.intakeKind === "prospect";
  const isWallMode = pathname === "/dashboard/wall" || pathname.startsWith("/dashboard/wall/");

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

  if (isWallMode) return null;

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
                const pathHref = "/" + segments.slice(0, i + 1).join("/");
                const isLast = i === segments.length - 1;
                const isLeadCollectionCrumb = Boolean(leadDetailId) && i === 0;
                const href =
                  isLeadCollectionCrumb && detailIsProspect ? "/prospects" : pathHref;
                const label =
                  isLast && leadDetailId
                    ? detailLead?.contactName || "Lead details"
                    : isLeadCollectionCrumb && detailIsProspect
                      ? "Prospects"
                      : toLabel(seg);
                return (
                  <React.Fragment key={pathHref}>
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink render={<Link href={href}>{label}</Link>} />
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
          <OrgTimezoneClock />
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
                    "relative shrink-0 overflow-visible",
                    bellUnread > 0 && "text-primary hover:bg-primary/10 hover:text-primary",
                  )}
                  aria-label={
                    bellUnread > 0
                      ? `Notifications and team chat, ${bellUnread} unread`
                      : "Notifications, none unread"
                  }
                >
                  <Bell className="h-4 w-4" aria-hidden />
                  {bellUnread > 0 && (
                    <Badge
                      variant="destructive"
                      className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[10px] font-semibold tabular-nums leading-none shadow-sm"
                    >
                      {bellUnread > 99 ? "99+" : bellUnread}
                    </Badge>
                  )}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-80 w-80 max-w-[min(20rem,calc(100vw-2rem))]">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-semibold">Notifications</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {sortedForMenu.length === 0 ? (
                  <DropdownMenuItem
                    disabled
                    className="h-auto cursor-default flex-col items-stretch gap-0 whitespace-normal py-3 text-left text-sm leading-snug text-muted-foreground opacity-100 data-disabled:pointer-events-none data-disabled:opacity-100 [&>svg]:hidden"
                  >
                    <span className="block w-full">
                      You&apos;re all caught up. Turn on{" "}
                      <span className="font-medium text-foreground">Demo</span> in the workspace menu for sample
                      alerts, or open <span className="font-medium text-foreground">Notifications</span> when you have
                      tasks assigned to you.
                    </span>
                  </DropdownMenuItem>
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
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="justify-center font-medium text-primary"
                  onSelect={() => router.push("/notifications")}
                >
                  View all notifications
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <QuickAddButton />
        </div>
      </header>
      {cmdOpen ? <GlobalCommandMenu open={cmdOpen} onOpenChange={setCmdOpen} /> : null}
    </>
  );
}
