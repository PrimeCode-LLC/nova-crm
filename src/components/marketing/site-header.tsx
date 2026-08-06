import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { Logo } from "./logo";

const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export async function SiteHeader() {
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <header className="sticky top-0 z-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/85 via-background/45 to-transparent"
      />
      <div className="relative mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo size="sm" />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {hasSession ? (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              Go to dashboard
              <ArrowRight />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="hidden sm:inline-flex"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                Log in
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href="/#waitlist" />}
              >
                Reserve a slot
                <ArrowRight />
              </Button>
            </>
          )}

          <Sheet>
            <SheetTrigger
              render={
                <Button size="icon-sm" variant="ghost" className="md:hidden">
                  <Menu />
                  <span className="sr-only">Open menu</span>
                </Button>
              }
            />
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>
                  <Logo size="sm" />
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1 px-2">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="mt-3 border-t border-border pt-3">
                  {hasSession ? (
                    <Button
                      className="w-full"
                      nativeButton={false}
                      render={<Link href="/dashboard" />}
                    >
                      Go to dashboard
                      <ArrowRight />
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        className="w-full"
                        nativeButton={false}
                        render={<Link href="/login" />}
                      >
                        Log in
                      </Button>
                      <Button
                        className="w-full"
                        nativeButton={false}
                        render={<Link href="/#waitlist" />}
                      >
                        Reserve a slot
                      </Button>
                    </div>
                  )}
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
