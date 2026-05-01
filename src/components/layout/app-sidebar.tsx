"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, ChevronsUpDown, LogOut, UserCircle, Moon, Sun, Plus, FlaskConical, Check } from "lucide-react";
import { QuickAddDialog } from "./quick-add-dialog";
import { useTheme } from "next-themes";

import { NAV_SECTIONS } from "@/lib/nav";
import { mockUsers } from "@/lib/mock-data";
import { DEMO_ROLE_PRESETS } from "@/lib/demo-persona";
import { ROLES, APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isAuthDisabled } from "@/lib/auth/flags";

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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user: fbUser, signOut } = useAuth();
  const { isDemo, demoPersonaId, setDemoPersona } = useWorkspace();
  const mockUser =
    mockUsers.find((u) => u.id === demoPersonaId) ?? mockUsers[0]!;
  const useMockPersona = isDemo || isAuthDisabled() || !fbUser;
  const displayName = useMockPersona
    ? mockUser.displayName
    : fbUser.displayName || fbUser.email?.split("@")[0] || "User";
  const email = useMockPersona ? mockUser.email : (fbUser.email ?? "");
  const roleLabel = useMockPersona
    ? ROLES[mockUser.roleId].label
    : ROLES.salesperson.label;
  const avatarInitials = useMockPersona
    ? mockUser.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
    : (fbUser.displayName || fbUser.email || "?")
        .split(/[\s@]+/)
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">{APP_NAME}</span>
            <span className="text-[11px] text-muted-foreground">Sales ops, finally sane</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
                        {roleLabel}
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
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{displayName}</span>
                    <span className="text-xs text-muted-foreground">{email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isDemo && (
                  <>
                    <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      Sample user
                    </DropdownMenuLabel>
                    {DEMO_ROLE_PRESETS.map((p) => (
                      <DropdownMenuItem
                        key={p.userId}
                        onSelect={() => void setDemoPersona(p.userId)}
                        className="flex items-start gap-2 py-2"
                      >
                        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium leading-tight">{p.title}</span>
                            {p.userId === demoPersonaId && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground leading-snug">{p.subtitle}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onSelect={() => router.push("/settings")}>
                  <UserCircle className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? (
                    <Sun className="mr-2 h-4 w-4" />
                  ) : (
                    <Moon className="mr-2 h-4 w-4" />
                  )}
                  Toggle theme
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => void signOut()}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
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
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" className={cn("gap-2", className)} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Quick add
      </Button>
      <QuickAddDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
