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
import type { Department, PermissionOverride, User } from "@/lib/types";
import { Plus, Shield, Trash2, Info, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FeatureGrantsPanel } from "@/components/admin/feature-grants-panel";

const RESOURCES = ["leads", "deals", "accounts", "contacts", "activities"] as const;

const RESOURCE_LABELS: Record<(typeof RESOURCES)[number], string> = {
  leads: "Leads",
  deals: "Deals",
  accounts: "Companies",
  contacts: "Contacts",
  activities: "Activities",
};

function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource as keyof typeof RESOURCE_LABELS] ?? resource;
}

const ACTIONS = ["read", "write", "delete"] as const;
const SCOPES = ["own", "team", "department", "all", "custom"] as const;

const SCOPE_HELP: Record<(typeof SCOPES)[number], string> = {
  own: "Only CRM rows assigned to this person (owner / assignee fields).",
  team: "This person plus everyone in their reporting line below them (and optional anchor below).",
  department: "Everyone who belongs to the department you pick (membership is on each user).",
  all: "Everyone in the workspace (tenant-wide).",
  custom: "Describe the boundary in writing until automated rules exist for this grant or deny.",
};

type OverrideIdentity = Pick<
  PermissionOverride,
  | "userId"
  | "resource"
  | "action"
  | "scope"
  | "scopeDepartmentId"
  | "scopeTeamAnchorUserId"
  | "scopeCustomDefinition"
>;

function sameOverrideIdentity(a: OverrideIdentity, b: OverrideIdentity): boolean {
  return (
    a.userId === b.userId &&
    a.resource === b.resource &&
    a.action === b.action &&
    a.scope === b.scope &&
    (a.scopeDepartmentId ?? "") === (b.scopeDepartmentId ?? "") &&
    (a.scopeTeamAnchorUserId ?? "") === (b.scopeTeamAnchorUserId ?? "") &&
    (a.scopeCustomDefinition ?? "").trim().toLowerCase() ===
      (b.scopeCustomDefinition ?? "").trim().toLowerCase()
  );
}

type ColumnFilterKey = "resource" | "action" | "scope" | "effect";

function newOverrideId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `po-${crypto.randomUUID()}`;
  }
  return `po-${Date.now()}`;
}

/** Readable label when Firestore has no name yet (displayName falls back to uid). */
function memberPickerLabel(
  u: User,
  getOwnerDisplayName: (uid: string) => string | undefined,
): string {
  const fromLookup = getOwnerDisplayName(u.id)?.trim() || "";
  const name = u.displayName?.trim() || fromLookup;
  if (name && name !== u.id) return name;
  const em = u.email?.trim();
  if (em) return em;
  if (u.id.length >= 16) return `Member ${u.id.slice(0, 4)}…${u.id.slice(-4)}`;
  return u.id;
}

function formatScopeTargetLine(
  po: PermissionOverride,
  departments: readonly Department[],
  users: readonly User[],
  getOwnerDisplayName: (uid: string) => string | undefined,
): string | null {
  if (po.scope === "department" && po.scopeDepartmentId) {
    return departments.find((d) => d.id === po.scopeDepartmentId)?.name ?? po.scopeDepartmentId;
  }
  if (po.scope === "custom" && po.scopeCustomDefinition?.trim()) {
    const t = po.scopeCustomDefinition.trim();
    return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  }
  if (po.scope === "team" && po.scopeTeamAnchorUserId) {
    const u = users.find((x) => x.id === po.scopeTeamAnchorUserId);
    return u
      ? `Subtree: ${memberPickerLabel(u, getOwnerDisplayName)}`
      : `Subtree: ${po.scopeTeamAnchorUserId}`;
  }
  return null;
}

export default function AdminPermissionsPage() {
  const {
    permissionOverrides,
    users,
    departments,
    currentUserId,
    addPermissionOverride,
    removePermissionOverride,
    getOwnerDisplayName,
  } = useWorkspace();
  const [newOpen, setNewOpen] = React.useState(false);
  const [userId, setUserId] = React.useState("");
  const [resource, setResource] = React.useState("");
  const [action, setAction] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [scopeDepartmentId, setScopeDepartmentId] = React.useState("");
  const [scopeCustomDefinition, setScopeCustomDefinition] = React.useState("");
  const [scopeTeamAnchorUserId, setScopeTeamAnchorUserId] = React.useState("");
  const [effect, setEffect] = React.useState<"grant" | "deny">("grant");
  const [note, setNote] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [columnFilter, setColumnFilter] = React.useState<Partial<
    Record<ColumnFilterKey, string>
  >>({});

  function resetForm() {
    setUserId("");
    setResource("");
    setAction("");
    setScope("");
    setScopeDepartmentId("");
    setScopeCustomDefinition("");
    setScopeTeamAnchorUserId("");
    setEffect("grant");
    setNote("");
  }

  const usersWhoManageOthers = React.useMemo(() => {
    const withReport = new Set(users.filter((u) => users.some((r) => r.managerId === u.id)).map((u) => u.id));
    return users.filter((u) => withReport.has(u.id));
  }, [users]);

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

  const formComplete = React.useMemo(() => {
    if (!userId || !resource || !action || !scope) return false;
    if (scope === "department") {
      if (departments.length === 0) return false;
      return Boolean(scopeDepartmentId);
    }
    if (scope === "custom") {
      return scopeCustomDefinition.trim().length >= 8;
    }
    return true;
  }, [
    userId,
    resource,
    action,
    scope,
    departments.length,
    scopeDepartmentId,
    scopeCustomDefinition,
  ]);

  function handleCreate() {
    if (!userId || !resource || !action || !scope) {
      toast.error("All fields are required");
      return;
    }
    const draftIdentity: OverrideIdentity = {
      userId,
      resource: resource as PermissionOverride["resource"],
      action: action as PermissionOverride["action"],
      scope: scope as PermissionOverride["scope"],
      scopeDepartmentId: scope === "department" ? scopeDepartmentId || undefined : undefined,
      scopeTeamAnchorUserId:
        scope === "team" && scopeTeamAnchorUserId ? scopeTeamAnchorUserId : undefined,
      scopeCustomDefinition:
        scope === "custom" ? scopeCustomDefinition.trim() || undefined : undefined,
    };
    const duplicate = permissionOverrides.some((p) => sameOverrideIdentity(p, draftIdentity));
    if (duplicate) {
      toast.error("This override already exists", {
        description: "Remove the existing row or change scope details.",
      });
      return;
    }
    const row: PermissionOverride = {
      id: newOverrideId(),
      userId,
      resource: draftIdentity.resource,
      action: draftIdentity.action,
      scope: draftIdentity.scope,
      effect,
      ...(draftIdentity.scopeDepartmentId
        ? { scopeDepartmentId: draftIdentity.scopeDepartmentId }
        : {}),
      ...(draftIdentity.scopeTeamAnchorUserId
        ? { scopeTeamAnchorUserId: draftIdentity.scopeTeamAnchorUserId }
        : {}),
      ...(draftIdentity.scopeCustomDefinition
        ? { scopeCustomDefinition: draftIdentity.scopeCustomDefinition }
        : {}),
      note: note.trim() || undefined,
      createdBy: currentUserId || "u-director",
      createdAt: new Date().toISOString(),
    };
    addPermissionOverride(row);
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
        description="CRM record access overrides and per-user admin feature grants — without changing roles."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New override
          </Button>
        }
      />
      <PageBody className="space-y-6">
        <FeatureGrantsPanel />

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
              A <em>deny</em> for a given resource and action removes that permission for the person, even if their role would grant it. Use sparingly; most access should flow from roles.
            </p>
          </div>
        </div>

        {hasColumnFilters && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Table filter:</span>
            {columnFilter.resource && (
              <Badge variant="secondary" className="gap-1 font-normal">
                resource: {resourceLabel(columnFilter.resource)}
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
                            {resourceLabel(po.resource)}
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
                      <TableCell className="py-2 max-w-[200px]">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <button
                            type="button"
                            className="inline-flex self-start"
                            title="Filter by this scope"
                            onClick={() => toggleColumnFilter("scope", po.scope)}
                          >
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] cursor-pointer transition-colors capitalize",
                                columnFilter.scope === po.scope && "ring-2 ring-primary/40",
                              )}
                            >
                              {po.scope}
                            </Badge>
                          </button>
                          {(() => {
                            const line = formatScopeTargetLine(
                              po,
                              departments,
                              users,
                              getOwnerDisplayName,
                            );
                            return line ? (
                              <span className="text-[10px] text-muted-foreground leading-snug line-clamp-3">
                                {line}
                              </span>
                            ) : null;
                          })()}
                        </div>
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" /> New permission override
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">User</Label>
              <Select
                value={userId}
                onValueChange={(v) => setUserId(v ?? "")}
                disabled={users.length === 0}
              >
                <SelectTrigger className="h-9 w-full min-w-0">
                  <SelectValue placeholder="Select user">
                    {(value) => {
                      if (value == null || value === "") return "Select user";
                      const u = users.find((x) => x.id === value);
                      return u ? memberPickerLabel(u, getOwnerDisplayName) : String(value);
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {memberPickerLabel(u, getOwnerDisplayName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {users.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No workspace members loaded yet — check org membership or try refreshing.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Resource</Label>
                <Select value={resource} onValueChange={(v) => setResource(v ?? "")}>
                  <SelectTrigger className="h-9 w-full min-w-0">
                    <SelectValue placeholder="Resource" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {RESOURCE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Action</Label>
                <Select value={action} onValueChange={(v) => setAction(v ?? "")}>
                  <SelectTrigger className="h-9 w-full min-w-0">
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
              <Select
                value={scope}
                onValueChange={(v) => {
                  const next = v ?? "";
                  setScope(next);
                  setScopeDepartmentId("");
                  setScopeCustomDefinition("");
                  setScopeTeamAnchorUserId("");
                }}
              >
                <SelectTrigger className="h-auto min-h-9 w-full min-w-0 py-1.5">
                  <SelectValue placeholder="Scope">
                    {(value) =>
                      value && SCOPES.includes(value as (typeof SCOPES)[number])
                        ? (value as string).charAt(0).toUpperCase() + (value as string).slice(1)
                        : "Scope"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s} className="items-start py-2">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium capitalize leading-none">{s}</span>
                        <span className="text-[11px] text-muted-foreground leading-snug whitespace-normal">
                          {SCOPE_HELP[s]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(scope === "own" || scope === "all") && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {SCOPE_HELP[scope as "own" | "all"]}
                </p>
              )}

              {scope === "department" && (
                <div className="space-y-1.5 rounded-md border bg-muted/15 p-3">
                  <Label className="text-xs">Department</Label>
                  {departments.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No departments in this workspace yet. Add them under{" "}
                      <span className="font-medium text-foreground">Admin → Departments</span> before
                      using department scope.
                    </p>
                  ) : (
                    <Select
                      value={scopeDepartmentId}
                      onValueChange={(v) => setScopeDepartmentId(v ?? "")}
                    >
                      <SelectTrigger className="h-9 w-full min-w-0">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {scope === "team" && (
                <div className="space-y-1.5 rounded-md border bg-muted/15 p-3">
                  <Label className="text-xs">Team anchor (optional)</Label>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {`Leave empty for "this user and everyone reporting to them." Pick a manager to mean "that person and their reporting subtree" instead.`}
                  </p>
                  {usersWhoManageOthers.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No managers with direct reports in the roster — anchor is unavailable.
                    </p>
                  ) : (
                    <Select
                      value={scopeTeamAnchorUserId || "__none__"}
                      onValueChange={(v) =>
                        setScopeTeamAnchorUserId(v === "__none__" ? "" : (v ?? ""))
                      }
                    >
                      <SelectTrigger className="h-9 w-full min-w-0">
                        <SelectValue placeholder={"Default (this user's tree)"}>
                          {(value) => {
                            if (value == null || value === "" || value === "__none__") {
                              return `Default (this user's tree)`;
                            }
                            const u = users.find((x) => x.id === value);
                            return u ? memberPickerLabel(u, getOwnerDisplayName) : String(value);
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{`Default (this user's tree)`}</SelectItem>
                        {usersWhoManageOthers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {memberPickerLabel(u, getOwnerDisplayName)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {scope === "custom" && (
                <div className="space-y-1.5 rounded-md border bg-muted/15 p-3">
                  <Label className="text-xs">Custom scope definition</Label>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {`Describe exactly what this person may or may not see (e.g. "only leads tagged Partner", "companies in EU region"). Minimum 8 characters.`}
                  </p>
                  <Textarea
                    value={scopeCustomDefinition}
                    onChange={(e) => setScopeCustomDefinition(e.target.value)}
                    placeholder="e.g. Read-only on leads owned by the Upwork team, excluding archived…"
                    className="min-h-[88px] text-sm resize-y"
                  />
                </div>
              )}
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
            <Button size="sm" onClick={handleCreate} disabled={!formComplete}>
              Create override
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
