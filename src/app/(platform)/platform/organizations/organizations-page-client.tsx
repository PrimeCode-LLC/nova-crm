"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  Plus,
  MoreHorizontal,
  Search,
  Archive,
  Ban,
  Pencil,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgStatusBadge } from "@/components/platform/org-status-badge";
import type { Organization, OrganizationStatus } from "@/lib/types";
import { fmtRelative, fmtDate } from "@/lib/format";
import { toast } from "sonner";

export default function PlatformOrganizationsPage() {
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("filter");

  const [items, setItems] = React.useState<Organization[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "active" | "trial" | "active_only" | "suspended" | "archived"
  >(initialFilter === "unnamed" ? "all" : "active");
  const [showArchived, setShowArchived] = React.useState(false);
  const [unnamedOnly, setUnnamedOnly] = React.useState(initialFilter === "unnamed");
  const [bulkAction, setBulkAction] = React.useState<"suspend_unnamed" | "archive_unnamed" | null>(
    null,
  );
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [actionOrg, setActionOrg] = React.useState<{
    org: Organization;
    action: "suspend" | "archive" | "restore";
  } | null>(null);
  const [actionRunning, setActionRunning] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/platform/organizations");
    const data = (await res.json()) as { organizations?: Organization[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    setItems(data.organizations ?? []);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((o) => {
      if (!showArchived && o.status === "archived") return false;
      if (unnamedOnly && o.name?.trim()) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "active" &&
        statusFilter !== "active_only" &&
        o.status !== statusFilter
      ) {
        return false;
      }
      if (statusFilter === "active" && (o.status === "archived" || o.status === "suspended")) {
        return false;
      }
      if (statusFilter === "active_only" && o.status !== "active") {
        return false;
      }
      if (!q) return true;
      return (
        o.name?.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        o.primaryEmail?.toLowerCase().includes(q) ||
        o.pendingOwnerEmail?.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter, showArchived, unnamedOnly]);

  const unnamedCount = items.filter((o) => !o.name?.trim() && o.status !== "archived").length;

  async function runBulk() {
    if (!bulkAction) return;
    setBulkRunning(true);
    try {
      const res = await fetch("/api/platform/organizations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: bulkAction }),
      });
      const data = (await res.json()) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Bulk action failed");
      toast.success(`Updated ${data.updated ?? 0} organization(s)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkRunning(false);
      setBulkAction(null);
    }
  }

  async function runOrgAction() {
    if (!actionOrg) return;
    setActionRunning(true);
    try {
      const statusMap: Record<string, OrganizationStatus> = {
        suspend: "suspended",
        archive: "archived",
        restore: "active",
      };
      const res = await fetch(`/api/platform/organizations/${actionOrg.org.id}`, {
        method: actionOrg.action === "archive" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body:
          actionOrg.action === "archive"
            ? undefined
            : JSON.stringify({ status: statusMap[actionOrg.action] }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast.success(
        actionOrg.action === "restore"
          ? "Organization restored"
          : actionOrg.action === "archive"
            ? "Organization archived"
            : "Organization suspended",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionRunning(false);
      setActionOrg(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each organization is a tenant. CRM data is isolated by{" "}
            <code className="rounded bg-muted px-1">organizationId</code> in PostgreSQL with
            row-level security.
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, slug, email, ID…"
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active + trial</SelectItem>
            <SelectItem value="trial">Trial only</SelectItem>
            <SelectItem value="active_only">Active only</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={unnamedOnly ? "secondary" : "outline"}
          size="sm"
          onClick={() => setUnnamedOnly((v) => !v)}
        >
          Unnamed {unnamedCount > 0 ? `(${unnamedCount})` : ""}
        </Button>
        <Button
          type="button"
          variant={showArchived ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {unnamedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">
            Bulk cleanup: {unnamedCount} unnamed workspace{unnamedCount === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBulkAction("suspend_unnamed")}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Suspend all unnamed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBulkAction("archive_unnamed")}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            Archive all unnamed
          </Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Building2 className="mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">
            {items.length === 0 ? "No organizations yet" : "No matches"}
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {items.length === 0
              ? "Create the first tenant to track plans, status, and operator settings."
              : "Try adjusting your search or filters."}
          </p>
          {items.length === 0 && (
            <Link
              href="/platform/organizations/new"
              className={cn(buttonVariants({ size: "sm" }), "mt-4")}
            >
              Create organization
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Trial ends</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/platform/organizations/${o.id}`}
                      className="text-primary hover:underline"
                    >
                      {o.name?.trim() || (
                        <span className="italic text-muted-foreground">Unnamed workspace</span>
                      )}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{o.slug}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.primaryEmail ?? o.pendingOwnerEmail ?? "—"}
                  </TableCell>
                  <TableCell>
                    <OrgStatusBadge status={o.status} />
                  </TableCell>
                  <TableCell>{o.planId}</TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {o.seatsUsed ?? 0}
                    {o.maxUsers != null ? ` / ${o.maxUsers}` : ""}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.status === "trial" ? fmtDate(o.trialEndsAt, "MMM d") : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {fmtRelative(o.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            window.location.href = `/platform/organizations/${o.id}`;
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        {o.status !== "suspended" && o.status !== "archived" && (
                          <DropdownMenuItem onClick={() => setActionOrg({ org: o, action: "suspend" })}>
                            <Ban className="mr-2 h-4 w-4" />
                            Suspend
                          </DropdownMenuItem>
                        )}
                        {o.status === "archived" || o.status === "suspended" ? (
                          <DropdownMenuItem onClick={() => setActionOrg({ org: o, action: "restore" })}>
                            Restore to active
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        {o.status !== "archived" && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setActionOrg({ org: o, action: "archive" })}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Showing {filtered.length} of {items.length} organizations
          </p>
        </div>
      )}

      <AlertDialog open={Boolean(bulkAction)} onOpenChange={(open) => !open && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "archive_unnamed" ? "Archive unnamed workspaces?" : "Suspend unnamed workspaces?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This affects {unnamedCount} organization(s) with no display name. CRM data is retained;
              tenants lose access when suspended or archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={bulkRunning} onClick={() => void runBulk()}>
              {bulkRunning ? "Running…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(actionOrg)} onOpenChange={(open) => !open && setActionOrg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionOrg?.action === "archive"
                ? "Archive organization?"
                : actionOrg?.action === "suspend"
                  ? "Suspend organization?"
                  : "Restore organization?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionOrg?.org.name?.trim() || actionOrg?.org.slug} —{" "}
              {actionOrg?.action === "restore"
                ? "Members will regain access based on their roles."
                : "Members will be blocked from signing in until restored."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={actionRunning} onClick={() => void runOrgAction()}>
              {actionRunning ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
