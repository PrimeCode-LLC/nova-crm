import Link from "next/link";
import { requirePlatformAdminSession } from "@/lib/platform/require-platform-admin";
import { AppMark } from "@/components/brand/app-mark";
import { cn } from "@/lib/utils";

export default async function PlatformShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdminSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <PlatformNavLink href="/platform">Overview</PlatformNavLink>
            <PlatformNavLink href="/platform/organizations">Organizations</PlatformNavLink>
            <PlatformNavLink href="/platform/admins">Super admins</PlatformNavLink>
            <PlatformNavLink href="/platform/settings">Ops / spend</PlatformNavLink>
            <Link
              href="/dashboard"
              className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
            >
              ← CRM workspace
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}

function PlatformNavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
