"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Shield,
  Wrench,
  Users,
  AlertTriangle,
  ArrowRight,
  Plus,
  ClipboardList,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/platform/stat-card";
import { OrgStatusBadge } from "@/components/platform/org-status-badge";
import { MigrateExistingUsersButton } from "./migrate-existing-users";
import type { PlatformStats } from "@/lib/types";
import { fmtRelative } from "@/lib/format";

export default function PlatformOverviewPage() {
  const [stats, setStats] = React.useState<PlatformStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/stats");
        const data = (await res.json()) as { stats?: PlatformStats; error?: string };
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        if (!cancelled) setStats(data.stats ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Operate the product as SaaS: customer organizations, plans, tenant settings, and
            who can access this console.
          </p>
        </div>
        <Link href="/platform/organizations/new" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
          <Plus className="h-4 w-4" />
          New organization
        </Link>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[108px] rounded-xl" />
          ))
        ) : stats ? (
          <>
            <StatCard
              title="Organizations"
              value={stats.totalOrgs}
              description={`${stats.byStatus.active} active · ${stats.byStatus.trial} trial`}
              icon={Building2}
            />
            <StatCard
              title="Seats in use"
              value={stats.totalSeatsUsed}
              description="Across all tenants"
              icon={Users}
            />
            <StatCard
              title="Trials expiring"
              value={stats.trialsExpiringSoon}
              description="Within 7 days"
              icon={AlertTriangle}
              tone={stats.trialsExpiringSoon > 0 ? "warning" : "default"}
            />
            <StatCard
              title="Platform admins"
              value={stats.adminCount}
              description={
                stats.bootstrapAdminCount > 0
                  ? `${stats.bootstrapAdminCount} bootstrap via env`
                  : "Stored in database"
              }
              icon={Shield}
            />
          </>
        ) : null}
      </div>

      {stats && stats.unnamedCount > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {stats.unnamedCount} unnamed workspace{stats.unnamedCount === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>
              Likely from legacy migration. Review and rename or archive from the organizations
              list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/platform/organizations?filter=unnamed"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Review unnamed workspaces
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent organizations</CardTitle>
            <CardDescription>Last updated tenants</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : stats?.recentOrgs.length ? (
              <ul className="divide-y">
                {stats.recentOrgs.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/platform/organizations/${o.id}`}
                        className="truncate font-medium text-primary hover:underline"
                      >
                        {o.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{o.slug}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <OrgStatusBadge status={o.status} />
                      <span className="text-xs text-muted-foreground">{fmtRelative(o.updatedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No organizations yet.</p>
            )}
            <Link
              href="/platform/organizations"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-3 gap-1")}
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Organizations
              </CardTitle>
              <CardDescription>
                Create and suspend tenants, set plans, billing contact, and internal notes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/platform/organizations"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Manage organizations
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4" />
                Super admins
              </CardTitle>
              <CardDescription>
                Grant platform access by email. Remove access when someone leaves.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/platform/admins"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Manage super admins
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" />
                Audit log
              </CardTitle>
              <CardDescription>Platform operator actions across all tenants.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/platform/audit"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                View audit log
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" />
            One-shot: migrate legacy users
          </CardTitle>
          <CardDescription>
            For users who signed up before multi-tenant landed. Creates a personal workspace for
            each user without an organization. Idempotent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MigrateExistingUsersButton />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Bootstrap: set <code className="rounded bg-muted px-1 py-0.5">PLATFORM_ADMIN_EMAILS</code>{" "}
        in the server environment so the first operators can sign in before platform admin records
        exist in Postgres.
      </p>
    </div>
  );
}
