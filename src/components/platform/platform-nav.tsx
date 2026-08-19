"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppMark } from "@/components/brand/app-mark";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/platform", label: "Overview", exact: true },
  { href: "/platform/organizations", label: "Organizations" },
  { href: "/platform/admins", label: "Super admins" },
  { href: "/platform/audit", label: "Audit log" },
] as const;

export function PlatformNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link
          href="/platform"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <AppMark />
          <span>Platform</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 text-sm">
          {NAV.map((item) => {
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/dashboard"
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          >
            ← CRM workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
