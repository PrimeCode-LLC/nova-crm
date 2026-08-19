"use client";

import * as React from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { PlatformAdminRecord, PlatformAdminRole } from "@/lib/types";
import { toast } from "sonner";
import { fmtRelative } from "@/lib/format";

export default function PlatformAdminsPage() {
  const [admins, setAdmins] = React.useState<PlatformAdminRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<PlatformAdminRole>("admin");
  const [adding, setAdding] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<PlatformAdminRecord | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [roleUpdating, setRoleUpdating] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/platform/admins");
    const data = (await res.json()) as { admins?: PlatformAdminRecord[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    setAdmins(data.admins ?? []);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch("/api/platform/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Platform access granted");
      setEmail("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(uid: string, nextRole: PlatformAdminRole) {
    setRoleUpdating(uid);
    try {
      const res = await fetch("/api/platform/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, role: nextRole }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Role updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setRoleUpdating(null);
    }
  }

  async function revoke(uid: string) {
    setRevoking(true);
    try {
      const res = await fetch(`/api/platform/admins?uid=${encodeURIComponent(uid)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Access removed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  }

  const storedAdmins = admins.filter((a) => !a.bootstrap);
  const bootstrapAdmins = admins.filter((a) => a.bootstrap);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/platform" className="text-xs text-muted-foreground hover:text-foreground">
          ← Platform overview
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Super admins</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          These users can open this platform console and manage all tenants. They are not the same
          as workspace <span className="font-medium text-foreground">isSuperAdmin</span> inside
          the CRM.
        </p>
      </div>

      <form
        onSubmit={addAdmin}
        className="flex max-w-xl flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="email">User email (must already have a Clerk account)</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="operator@yourcompany.com"
          />
        </div>
        <div className="w-full space-y-2 sm:w-36">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as PlatformAdminRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <button
          type="submit"
          disabled={adding || !email.trim()}
          className={cn(buttonVariants(), "sm:self-end")}
        >
          {adding ? "Adding…" : "Grant access"}
        </button>
      </form>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Since</TableHead>
                <TableHead className="w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No platform admins yet. Set{" "}
                    <code className="rounded bg-muted px-1">PLATFORM_ADMIN_EMAILS</code> or grant
                    access above.
                  </TableCell>
                </TableRow>
              ) : (
                admins.map((a) => (
                  <TableRow key={a.uid}>
                    <TableCell className="font-mono text-xs">{a.email}</TableCell>
                    <TableCell>
                      {a.bootstrap ? (
                        <Badge variant="secondary">{a.role}</Badge>
                      ) : (
                        <Select
                          value={a.role}
                          disabled={roleUpdating === a.uid}
                          onValueChange={(v) => void changeRole(a.uid, v as PlatformAdminRole)}
                        >
                          <SelectTrigger className="h-8 w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.bootstrap ? (
                        <Badge variant="outline" className="text-xs">
                          Bootstrap env
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Database</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {a.bootstrap ? "—" : fmtRelative(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.bootstrap && (
                        <button
                          type="button"
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                          onClick={() => setRevokeTarget(a)}
                        >
                          Revoke
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {bootstrapAdmins.length > 0 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {bootstrapAdmins.length} bootstrap admin(s) from env · {storedAdmins.length} stored
              in database
            </p>
          )}
        </div>
      )}

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke platform access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.email} will no longer be able to open this console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={() => revokeTarget && void revoke(revokeTarget.uid)}
            >
              {revoking ? "Removing…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
