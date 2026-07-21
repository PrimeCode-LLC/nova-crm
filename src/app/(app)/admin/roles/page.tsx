"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, MoreHorizontal, Plus, Shield, Trash2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";
import type { RoleListItem } from "@/lib/permissions/role-types";

export default function AdminRolesPage() {
  const router = useRouter();
  const [roles, setRoles] = React.useState<RoleListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createDescription, setCreateDescription] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<RoleListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org/roles");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to load roles",
        );
      }
      setRoles(data.roles ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) {
      toast.error("Enter a role name");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/org/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: createDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to create role",
        );
      }
      toast.success("Role created");
      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      router.push(`/admin/roles/${encodeURIComponent(data.role.id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(role: RoleListItem) {
    try {
      const res = await fetch("/api/org/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${role.name} copy`,
          description: role.description,
          duplicateFromId: role.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to duplicate",
        );
      }
      toast.success("Role duplicated");
      router.push(`/admin/roles/${encodeURIComponent(data.role.id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/org/roles/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to delete",
        );
      }
      toast.success("Role deleted");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="CRM permissions"
        description="Permission roles define module access, data boundaries, and sensitive actions. They are separate from workspace Owner, Admin, Manager, and Member access."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create permission role
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <div className="rounded-lg border bg-muted/20 p-4 flex gap-3">
          <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Permission roles + person overrides</p>
            <p className="text-muted-foreground text-xs">
              Permission roles define default module CRUD, data scope, and sensitive actions. Use{" "}
              <Link href="/admin/permissions" className="underline underline-offset-2">
                Person overrides
              </Link>{" "}
              for exceptions on individual members.
            </p>
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9">Permission role</TableHead>
                <TableHead className="h-9">Type</TableHead>
                <TableHead className="h-9">Members</TableHead>
                <TableHead className="h-9">Updated</TableHead>
                <TableHead className="h-9 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Loading roles…
                  </TableCell>
                </TableRow>
              ) : roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No permission roles yet.
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="py-2">
                      <Link
                        href={`/admin/roles/${encodeURIComponent(role.id)}`}
                        className="font-medium hover:underline underline-offset-2"
                      >
                        {role.name}
                      </Link>
                      {role.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {role.description}
                        </p>
                      ) : null}
                      {!role.isActive ? (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Inactive
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {role.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 tabular-nums text-sm">
                      {role.memberCount}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(role.updatedAt, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Role actions"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/admin/roles/${encodeURIComponent(role.id)}`)
                            }
                          >
                            Edit permissions
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleDuplicate(role)}>
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                          </DropdownMenuItem>
                          {role.kind === "custom" ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={role.memberCount > 0}
                                onClick={() => setDeleteTarget(role)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </PageBody>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create permission role</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Account Executive"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="What this role is for"
                className="min-h-[72px] text-sm resize-y"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Starts from Salesperson defaults. Edit modules and actions after creating.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>.
              Members must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
