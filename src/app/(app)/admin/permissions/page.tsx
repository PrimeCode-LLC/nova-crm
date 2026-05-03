"use client";

import * as React from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtDate } from "@/lib/format";
import type { PermissionOverride } from "@/lib/types";
import { Plus, Shield, Trash2, Info, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const RESOURCES = ["leads", "deals", "accounts", "contacts", "activities"] as const;
const ACTIONS = ["read", "write", "delete"] as const;
const SCOPES = ["own", "team", "department", "all", "custom"] as const;

type ColumnFilterKey = "resource" | "action" | "scope" | "effect";

function newOverrideId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `po-${crypto.randomUUID()}`;
  }
  return `po-${Date.now()}`;
}

export default function AdminPermissionsPage() {
  const {
    permissionOverrides,
    users,
    currentUserId,
    addPermissionOverride,
    removePermissionOverride,
  } = useWorkspace();
  const [newOpen, setNewOpen] = React.useState(false);
  const [userId, setUserId] = React.useState("");
  const [resource, setResource] = React.useState("");
  const [action, setAction] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [effect, setEffect] = React.useState<"grant" | "deny">("grant");
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [columnFilter, setColumnFilter] = React.useState<Partial<
    Record<ColumnFilterKey, string>
  >>({});

  function resetForm() {
    setUserId("");
    setResource("");
    setAction("");
    setScope("");
    setEffect("grant");
    setNote("");
  }

  function toggleColumnFilter(key: ColumnFilterKey, value: string) {
    setColumnFilter((f) => {
      const cur = f[key];
      if (cur === value) {
        const next = { ...f };
        delete next[key];
        return next;
      }
      return { ...f, [key]: value };
    });
  }

  const filteredOverrides = permissionOverrides.filter((po) => {
    if (columnFilter.resource && po.resource !== columnFilter.resource) return false;
    if (columnFilter.action && po.action !== columnFilter.action) return false;
    if (columnFilter.scope && po.scope !== columnFilter.scope) return false;
    if (columnFilter.effect && po.effect !== columnFilter.effect) return false;
    return true;
  });

  const hasColumnFilters = Object.keys(columnFilter).length > 0;

  function handleCreate() {
    if (!userId || !resource || !action || !scope) {
      toast.error("All fields are required");
      return;
    }
    setLoading(true);
    const row: PermissionOverride = {
      id: newOverrideId(),
      userId,
      resource: resource as PermissionOverride["resource"],
      action: action as PermissionOverride["action"],
      scope: scope as PermissionOverride["scope"],
      effect,
      note: note.trim() || undefined,
      createdBy: currentUserId || "u-director",
      createdAt: new Date().toISOString(),
    };
    addPermissionOverride(row);
    setLoading(false);
    toast.success("Permission override created");
    setNewOpen(false);
    resetForm();
  }

  function confirmDelete() {
    if (!deleteId) return;
    removePermissionOverride(deleteId);
    toast.success("Override removed");
    setDeleteId(null);
  }

  return (
    <>
      <PageHeader
        title="Permission Overrides"
        description="Fine-tune access per user. Overrides stack on top of role and department defaults."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New override
          </Button>
        }
      />
      <PageBody>
        {/* Explanation banner */}
        <div className="rounded-lg border bg-muted/20 p-4 flex gap-3">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">3-layer permission model</p>
            <div className="flex items-center gap-2 text-muted-foreground text-xs flex-wrap">
              <span className="rounded-md bg-background border px-2 py-0.5">Role default</span>
              <span className="text-muted-foreground/60">→</span>
              <span className="rounded-md bg-background border px-2 py-0.5">Department override</span>
              <span className="text-muted-foreground/60">→</span>
              <span className="rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 font-medium">
                Person override (wins)
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              A <em>deny</em> at any level blocks access, even if a lower layer grants it. Use sparingly; most access should flow from roles.
            </p>
          </div>
        </div>

        {hasColumnFilters && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Table filter:</span>
            {columnFilter.resource && (
              <Badge variant="secondary" className="gap-1 font-normal">
                resource: {columnFilter.resource}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear resource filter"
                  onClick={() => toggleColumnFilter("resource", columnFilter.resource!)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {columnFilter.action && (
              <Badge variant="secondary" className="gap-1 font-normal">
                action: {columnFilter.action}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear action filter"
                  onClick={() => toggleColumnFilter("action", columnFilter.action!)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {columnFilter.scope && (
              <Badge variant="secondary" className="gap-1 font-normal">
                scope: {columnFilter.scope}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear scope filter"
                  onClick={() => toggleColumnFilter("scope", columnFilter.scope!)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {columnFilter.effect && (
              <Badge variant="secondary" className="gap-1 font-normal">
                effect: {columnFilter.effect}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear effect filter"
                  onClick={() => toggleColumnFilter("effect", columnFilter.effect!)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setColumnFilter({})}>
              Clear all
            </Button>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Tip: click a resource, action, scope, or effect pill to filter the table. Click again to clear that column.
        </p>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">User</TableHead>
                  <TableHead className="h-9">Resource</TableHead>
                  <TableHead className="h-9">Action</TableHead>
                  <TableHead className="h-9">Scope</TableHead>
                  <TableHead className="h-9">Effect</TableHead>
                  <TableHead className="h-9">Note</TableHead>
                  <TableHead className="h-9">Created by</TableHead>
                  <TableHead className="h-9">Created</TableHead>
                  <TableHead className="h-9 w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOverrides.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      {hasColumnFilters
                        ? "No overrides match the current filters."
                        : "No permission overrides yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOverrides.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="py-2">
                        <UserChip
                          userId={po.userId}
                          size="xs"
                          profileHref={`/admin/users?user=${encodeURIComponent(po.userId)}`}
                        />
                      </TableCell>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          className="inline-flex"
                          title="Filter by this resource"
                          onClick={() => toggleColumnFilter("resource", po.resource)}
                        >
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-mono cursor-pointer transition-colors",
                              columnFilter.resource === po.resource && "ring-2 ring-primary/40",
                            )}
                          >
                            {po.resource}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          className="inline-flex"
                          title="Filter by this action"
                          onClick={() => toggleColumnFilter("action", po.action)}
                        >
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-mono cursor-pointer transition-colors",
                              columnFilter.action === po.action && "ring-2 ring-primary/40",
                            )}
                          >
                            {po.action}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          className="inline-flex"
                          title="Filter by this scope"
                          onClick={() => toggleColumnFilter("scope", po.scope)}
                        >
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] cursor-pointer transition-colors",
                              columnFilter.scope === po.scope && "ring-2 ring-primary/40",
                            )}
                          >
                            {po.scope}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          className="inline-flex"
                          title="Filter by grant/deny"
                          onClick={() => toggleColumnFilter("effect", po.effect)}
                        >
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-semibold uppercase cursor-pointer transition-colors",
                              po.effect === "grant"
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-destructive/10 text-destructive border-destructive/20",
                              columnFilter.effect === po.effect && "ring-2 ring-primary/40",
                            )}
                          >
                            {po.effect}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[240px] truncate">
                        {po.note ?? "-"}
                      </TableCell>
                      <TableCell className="py-2">
                        <UserChip
                          userId={po.createdBy}
                          size="xs"
                          profileHref={`/admin/users?user=${encodeURIComponent(po.createdBy)}`}
                        />
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(po.createdAt, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label="Remove override"
                          onClick={() => setDeleteId(po.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{permissionOverrides.length}</span>{" "}
          overrides active
          {hasColumnFilters && (
            <>
              {" "}
              · showing{" "}
              <span className="tabular-nums font-medium text-foreground">{filteredOverrides.length}</span>{" "}
              filtered
            </>
          )}
        </div>
      </PageBody>

      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          setNewOpen(open);
          if (open) resetForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" /> New permission override
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">User</Label>
              <Select value={userId} onValueChange={(v) => setUserId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Resource</Label>
                <Select value={resource} onValueChange={(v) => setResource(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Resource" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Action</Label>
                <Select value={action} onValueChange={(v) => setAction(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Effect</Label>
              <RadioGroup
                value={effect}
                onValueChange={(v) => setEffect(v as "grant" | "deny")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="grant" id="r-grant" />
                  <Label htmlFor="r-grant" className="text-sm text-success cursor-pointer">
                    Grant
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="deny" id="r-deny" />
                  <Label htmlFor="r-deny" className="text-sm text-destructive cursor-pointer">
                    Deny
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why is this override needed?"
                className="h-20 text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={loading}>
              {loading ? "Creating…" : "Create override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this override?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the person-level rule immediately. Role and department defaults still apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
