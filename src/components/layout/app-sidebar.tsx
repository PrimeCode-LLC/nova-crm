"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  LogOut,
  UserCircle,
  Moon,
  Sun,
  Plus,
  FlaskConical,
  Check,
  Monitor,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useOpenQuickAdd } from "./quick-add-launcher";
import { useTheme } from "next-themes";

import {
  getVisibleNavSections,
  type NavAccessContext,
  type NavItem,
} from "@/lib/nav";
import { DEMO_ROLE_PRESETS } from "@/lib/demo-persona";
import { ROLES, APP_NAME, roleLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useTeamChatUnread } from "@/components/providers/team-chat-unread-provider";
import { useInboxMailUnreadTotal } from "@/hooks/use-inbox-mail-unread-total";
import { useWorkspaceInboxNotifications } from "@/components/providers/workspace-inbox-notifications-provider";
import { formatUnreadBadgeCount } from "@/lib/email/inbox-unread-count";
import { isAuthDisabled } from "@/lib/auth/flags";
import { useComputedPermissions } from "@/lib/hooks/use-computed-permissions";
import type { Role } from "@/lib/types";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AppMark } from "@/components/brand/app-mark";

function NavMenuLinks({
  items,
  pathname,
  teamChatUnreadTotal,
  inboxMailUnreadTotal,
  notificationsUnreadTotal,
}: {
  items: NavItem[];
  pathname: string;
  teamChatUnreadTotal: number;
  inboxMailUnreadTotal: number;
  notificationsUnreadTotal: number;
}) {
  return (
    <>
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        const badge =
          item.href === "/inbox"
            ? formatUnreadBadgeCount(inboxMailUnreadTotal)
            : item.href === "/notifications"
              ? formatUnreadBadgeCount(notificationsUnreadTotal)
              : item.href === "/team-chat"
                ? formatUnreadBadgeCount(teamChatUnreadTotal)
                : null;
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={isActive}
              tooltip={item.label}
              render={
                <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {badge ? (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold tabular-nums text-white">
                      {badge}
                    </span>
                  ) : null}
                </Link>
              }
            />
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

function workspaceRoleSubtitle(
  roleId: Role | undefined,
  isSuperAdmin: boolean | undefined,
  opts: { loading: boolean; hasDoc: boolean },
): string {
  const { loading, hasDoc } = opts;
  if (loading && !hasDoc) return "…";
  let base: string;
  if (roleId && roleId in ROLES) {
    base = roleLabel(roleId);
  } else if (hasDoc) {
    base = typeof roleId === "string" ? roleId : "Member";
  } else {
    base = ROLES.salesperson.label;
  }
  if (isSuperAdmin) {
    return roleId && roleId in ROLES ? `${base} · Super admin` : "Super admin";
  }
  return base;
}

export function AppSidebar({
  showPlatformLink = false,
}: {
  showPlatformLink?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { signOut } = useAuth();
  const { isDemo, demoPersonaId, setDemoPersona, users, currentUserId, getUserById } =
    useWorkspace();
  const useMockPersona = isDemo || isAuthDisabled();
  const liveUser = useMockPersona ? null : getUserById(currentUserId) ?? null;
  const liveUid = useMockPersona ? undefined : currentUserId || undefined;
  const { data: roleSnapshot, loading: permsLoading } = useComputedPermissions(liveUid);
  const mockUser =
    users.find((u) => u.id === demoPersonaId) ?? users[0] ?? {
      id: demoPersonaId,
      displayName: "Demo user",
      email: "demo@example.com",
      roleId: "salesperson" as const,
    };
  const displayName = useMockPersona
    ? mockUser.displayName
    : liveUser?.displayName || liveUser?.email?.split("@")[0] || "User";
  const email = useMockPersona ? mockUser.email : (liveUser?.email ?? "");
  const displayRoleLabel = useMockPersona
    ? roleLabel(mockUser.roleId)
    : workspaceRoleSubtitle(liveUser?.roleId, liveUser?.isSuperAdmin, {
        loading: !liveUser && Boolean(liveUid),
        hasDoc: liveUser != null,
      });
  const avatarInitials = useMockPersona
    ? mockUser.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
    : (liveUser?.displayName || liveUser?.email || "?")
        .split(/[\s@]+/)
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

  const profileReady = useMockPersona || liveUser != null || Boolean(liveUid);
  const permsReady = useMockPersona || !profileReady || !permsLoading;

  const navAccess = React.useMemo<NavAccessContext>(
    () => ({
      roleId: useMockPersona ? mockUser.roleId : liveUser?.roleId,
      orgRole: useMockPersona ? mockUser.orgRole : liveUser?.orgRole,
      isSuperAdmin: !useMockPersona && Boolean(liveUser?.isSuperAdmin),
      featureGrants: useMockPersona ? mockUser.featureGrants : liveUser?.featureGrants,
      roleSnapshot: useMockPersona ? null : roleSnapshot,
      roleLoading: !useMockPersona && (!profileReady || !permsReady),
    }),
    [
      useMockPersona,
      mockUser.roleId,
      mockUser.orgRole,
      mockUser.featureGrants,
      liveUser?.roleId,
      liveUser?.orgRole,
      liveUser?.isSuperAdmin,
      liveUser?.featureGrants,
      roleSnapshot,
      profileReady,
      permsReady,
    ],
  );
  const sections = React.useMemo(
    () => getVisibleNavSections(navAccess),
    [
      navAccess.roleId,
      navAccess.orgRole,
      navAccess.isSuperAdmin,
      navAccess.featureGrants,
      navAccess.roleSnapshot,
      navAccess.roleLoading,
    ],
  );
  const { teamChatUnreadTotal } = useTeamChatUnread();
  const inboxMailUnreadTotal = useInboxMailUnreadTotal();
  const { unreadCount: notificationsUnreadTotal } = useWorkspaceInboxNotifications();

  if (pathname === "/dashboard/wall" || pathname.startsWith("/dashboard/wall/")) {
    return null;
  }

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <AppMark />
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">{APP_NAME}</span>
            <span className="text-[11px] text-muted-foreground">Sales ops, finally sane</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => {
          const isConfig = section.label === "Configuration";
          return (
            <SidebarGroup key={section.label}>
              {!isConfig && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                {isConfig ? (
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={pathname === "/admin" || pathname.startsWith("/admin/")}
                        tooltip="Configuration"
                        render={
                          <Link
                            href="/admin"
                            className="flex min-w-0 flex-1 items-center gap-2"
                          >
                            <SlidersHorizontal className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate">Configuration</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  </SidebarMenu>
                ) : (
                  <SidebarMenu>
                    <NavMenuLinks
                      items={section.items}
                      pathname={pathname}
                      teamChatUnreadTotal={teamChatUnreadTotal}
                      inboxMailUnreadTotal={inboxMailUnreadTotal}
                      notificationsUnreadTotal={notificationsUnreadTotal}
                    />
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
        {showPlatformLink && (
          <SidebarGroup>
            <SidebarGroupLabel>Product</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/platform")}
                    tooltip="Platform admin"
                    render={
                      <Link href="/platform">
                        <ShieldCheck />
                        <span>Platform admin</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <Avatar className="h-8 w-8 rounded-md">
                      <AvatarFallback className="rounded-md bg-primary/20 text-primary font-semibold">
                        {avatarInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {displayRoleLabel}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto h-4 w-4 opacity-60" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                side="right"
                align="end"
                className="min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="font-medium">{displayName}</span>
                      <span className="text-xs text-muted-foreground">{email}</span>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {isDemo && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Sample user
                      </DropdownMenuLabel>
                      {DEMO_ROLE_PRESETS.map((p) => (
                        <DropdownMenuItem
                          key={p.userId}
                          onSelect={() => void setDemoPersona(p.userId)}
                          className="flex items-start gap-2 py-2"
                        >
                          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium leading-tight">{p.title}</span>
                              {p.userId === demoPersonaId && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground leading-snug">{p.subtitle}</span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => router.push("/settings")}>
                    <UserCircle className="mr-2 h-4 w-4" /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Theme</span>
                      <span className="ml-auto mr-1 text-xs capitalize text-muted-foreground">
                        {theme ?? "system"}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-40">
                      {(
                        [
                          { value: "light", label: "Light", Icon: Sun },
                          { value: "dark", label: "Dark", Icon: Moon },
                          { value: "system", label: "System", Icon: Monitor },
                        ] as const
                      ).map(({ value, label, Icon }) => (
                        <DropdownMenuItem
                          key={value}
                          onSelect={() => setTheme(value)}
                          className="flex items-center gap-2 py-1.5"
                        >
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span>{label}</span>
                          {theme === value && (
                            <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => void signOut()}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function QuickAddButton({ className }: { className?: string }) {
  const { openQuickAdd } = useOpenQuickAdd();
  return (
    <Button size="sm" className={cn("gap-2", className)} onClick={() => openQuickAdd()}>
      <Plus className="h-4 w-4" /> Quick add
    </Button>
  );
}
