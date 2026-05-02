"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Organization } from "@/lib/types";
import { fmtRelative } from "@/lib/format";

const STATUS: Record<string, string> = {
  trial: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  active: "bg-success/10 text-success",
  suspended: "bg-destructive/10 text-destructive",
};

export default function PlatformOrganizationsPage() {
  const [items, setItems] = React.useState<Organization[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/organizations");
        const data = (await res.json()) as {
          organizations?: Organization[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        if (!cancelled) setItems(data.organizations ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each organization is a tenant you sell to. CRM data isolation by{" "}
            <code className="rounded bg-muted px-1">organizationId</code> is the next step in the
            product roadmap.
          </p>
        </div>
        <Link
          href="/platform/organizations/new"
          className={cn(buttonVariants({ size: "sm" }), "gap-2")}
        >
          <Plus className="h-4 w-4" />
          New organization
        </Link>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Building2 className="mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">No organizations yet</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Create the first tenant to track plans, status, and operator settings.
          </p>
          <Link
            href="/platform/organizations/new"
            className={cn(buttonVariants({ size: "sm" }), "mt-4")}
          >
            Create organization
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/platform/organizations/${o.id}`}
                      className="text-primary hover:underline"
                    >
                      {o.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS[o.status] ?? ""}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{o.planId}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">
                    {fmtRelative(o.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
