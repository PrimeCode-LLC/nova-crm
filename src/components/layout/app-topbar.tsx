"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, Command as CommandIcon, Search } from "lucide-react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function toLabel(segment: string) {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function AppTopbar() {
  const pathname = usePathname();
  const [cmdOpen, setCmdOpen] = React.useState(false);

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
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-4 w-4" />
            <Badge className="absolute -right-1 -top-1 h-4 w-4 rounded-full p-0 text-[10px]">3</Badge>
          </Button>
          <QuickAddButton />
        </div>
      </header>
      <GlobalCommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
