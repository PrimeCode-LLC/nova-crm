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
import type { PlatformAdminRecord } from "@/lib/types";
import { toast } from "sonner";
import { fmtRelative } from "@/lib/format";

export default function PlatformAdminsPage() {
  const [admins, setAdmins] = React.useState<PlatformAdminRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"owner" | "admin">("admin");
  const [adding, setAdding] = React.useState(false);

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

  async function revoke(uid: string) {
    if (!confirm("Remove this person’s platform admin access?")) return;
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
    }
  }

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
          <Label htmlFor="email">User email (must already have signed up)</Label>
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
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Since</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No Firestore records yet, operators matching{" "}
                    <code className="rounded bg-muted px-1">PLATFORM_ADMIN_EMAILS</code> still have
                    access.
                  </TableCell>
                </TableRow>
              ) : (
                admins.map((a) => (
                  <TableRow key={a.uid}>
                    <TableCell className="font-mono text-xs">{a.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{a.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {fmtRelative(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}
                        onClick={() => void revoke(a.uid)}
                      >
                        Revoke
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
