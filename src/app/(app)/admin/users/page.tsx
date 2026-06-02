"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { ROLES } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { Department, OrgMemberRole, PermissionOverride, Role, User } from "@/lib/types";
import { canManageOrgUsers } from "@/lib/can-manage-org-users";
import { canManageFeatureGrants } from "@/lib/can-manage-feature-grants";
import {
  FeatureGrantsEditor,
  featureGrantsSummary,
} from "@/components/admin/feature-grants-editor";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { selectTriggerLabelByIdName } from "@/lib/base-ui-select-label";
import {
  Search,
  UserPlus,
  Mail,
  Shield,
  Building2,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";

const NONE = "__none__" as const;

const STATUS_TONE: Record<User["status"], string> = {
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-muted text-muted-foreground border-transparent",
  pip: "bg-warning/10 text-warning border-warning/20",
};

const STATUS_LABEL: Record<User["status"], string> = {
  active: "Active",
  inactive: "Inactive",
  pip: "PIP",
};

const INVITE_ORG_ROLE_LABEL: Record<string, string> = {
  member: "Member",
  manager: "Manager",
  admin: "Admin",
  owner: "Owner",
};

function titleFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function userLabelShort(
  u: User | undefined,
  getOwnerDisplayName: (uid: string) => string | undefined,
): string {
  if (!u) return "";
  const fromLookup = getOwnerDisplayName(u.id)?.trim() || "";
  const name = u.displayName?.trim() || fromLookup;
  if (name && name !== u.id) return name;
  if (u.email?.trim()) return u.email.trim();
  if (u.id.length >= 16) return `${u.id.slice(0, 4)}…${u.id.slice(-4)}`;
  return u.id;
}

function permissionOverrideScopeDetail(
  po: PermissionOverride,
  departments: readonly Department[],
  users: readonly User[],
  getOwnerDisplayName: (uid: string) => string | undefined,
): string | null {
  if (po.scope === "department" && po.scopeDepartmentId) {
    return departments.find((d) => d.id === po.scopeDepartmentId)?.name ?? po.scopeDepartmentId;
  }
  if (po.scope === "custom" && po.scopeCustomDefinition?.trim()) {
    return po.scopeCustomDefinition.trim();
  }
  if (po.scope === "team" && po.scopeTeamAnchorUserId) {
    const u = users.find((x) => x.id === po.scopeTeamAnchorUserId);
    return u
      ? `Subtree: ${userLabelShort(u, getOwnerDisplayName)}`
      : `Subtree: ${po.scopeTeamAnchorUserId}`;
  }
  return null;
}

function AdminUsersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    users: wsUsers,
    departments,
    permissionOverrides,
    currentUserId,
    getUserById,
    getOwnerDisplayName,
    patchUser,
    mode,
    isDemo,
  } = useWorkspace();

  const viewer = getUserById(currentUserId);
  const canManage = canManageOrgUsers(viewer);
  const canEditFeatureGrants = canManageFeatureGrants(viewer);

  const users = wsUsers;

  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [deptFilter, setDeptFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(
    null,
  );

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<OrgMemberRole | "">("");
  const [inviteDept, setInviteDept] = React.useState(NONE);
  const [inviteLoading, setInviteLoading] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editUserId, setEditUserId] = React.useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editTitle, setEditTitle] = React.useState("");
  const [editRole, setEditRole] = React.useState<Role>("salesperson");
  const [editDept, setEditDept] = React.useState<string>(NONE);
  const [editManager, setEditManager] = React.useState<string>(NONE);
  const [editStatus, setEditStatus] = React.useState<User["status"]>("active");
  const [editFeatureGrants, setEditFeatureGrants] = React.useState<AdminFeatureKey[]>([]);
  const [editSaving, setEditSaving] = React.useState(false);

  const editingUser = editUserId
    ? users.find((u) => u.id === editUserId) ?? null
    : null;

  const urlUserParam = searchParams.get("user");
  const urlUserId =
    urlUserParam && users.some((u) => u.id === urlUserParam) ? urlUserParam : null;

  /** After closing the sheet for this URL user, do not re-open until the `user` param changes. */
  const dismissedUrlUserId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!urlUserId) dismissedUrlUserId.current = null;
    else if (dismissedUrlUserId.current && dismissedUrlUserId.current !== urlUserId) {
      dismissedUrlUserId.current = null;
    }
  }, [urlUserId]);

  const sheetUserId =
    selectedUserId ??
    (urlUserId && dismissedUrlUserId.current !== urlUserId ? urlUserId : null);

  const selectedUser = sheetUserId ? users.find((u) => u.id === sheetUserId) ?? null : null;

  function handleUserSheetOpenChange(open: boolean) {
    if (!open) {
      setSelectedUserId(null);
      if (urlUserId) dismissedUrlUserId.current = urlUserId;
      if (searchParams.get("user")) {
        router.replace("/admin/users", { scroll: false });
      }
    }
  }

  React.useEffect(() => {
    if (!inviteOpen) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("");
      setInviteDept(NONE);
      setInviteLoading(false);
    }
  }, [inviteOpen]);

  React.useEffect(() => {
    if (!canManage) {
      setInviteOpen(false);
      closeEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeEdit is stable enough; avoid loop
  }, [canManage]);

  React.useEffect(() => {
    if (!editOpen || !editingUser) return;
    setEditDisplayName(editingUser.displayName);
    setEditEmail(editingUser.email);
    setEditTitle(editingUser.title ?? "");
    setEditRole(editingUser.roleId);
    setEditDept(editingUser.departmentId ?? NONE);
    setEditManager(editingUser.managerId ?? NONE);
    setEditStatus(editingUser.status);
    setEditFeatureGrants(editingUser.featureGrants ?? []);
  }, [editOpen, editingUser]);

  const filtered = users.filter((u) => {
    const q = query.toLowerCase();
    const matchQuery =
      !q ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    const matchRole = roleFilter === "all" || u.roleId === roleFilter;
    const matchDept = deptFilter === "all" || u.departmentId === deptFilter;
    const matchStatus = statusFilter === "all" || u.status === statusFilter;
    return matchQuery && matchRole && matchDept && matchStatus;
  });

  const hasActiveFilters =
    query.trim() !== "" ||
    roleFilter !== "all" ||
    deptFilter !== "all" ||
    statusFilter !== "all";

  function clearFilters() {
    setQuery("");
    setRoleFilter("all");
    setDeptFilter("all");
    setStatusFilter("all");
  }

  function openEdit(user: User) {
    if (!canManage) return;
    setEditUserId(user.id);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditUserId(null);
  }

  async function handleSaveEdit() {
    if (!editUserId || !editingUser) return;
    const email = editEmail.trim();
    if (!editDisplayName.trim() || !email) {
      toast.error("Name and email are required");
      return;
    }
    setEditSaving(true);
    const patch: Partial<Omit<User, "id">> = {
      displayName: editDisplayName.trim(),
      email,
      title: editTitle.trim() || undefined,
      roleId: editRole,
      departmentId: editDept === NONE ? undefined : editDept,
      managerId: editManager === NONE ? undefined : editManager,
      status: editStatus,
      featureGrants: editFeatureGrants.length ? editFeatureGrants : undefined,
    };

    const writeGrantsLive =
      canEditFeatureGrants && mode === "live" && !isDemo && isFirebaseWebConfigured();
    if (writeGrantsLive) {
      const res = await fetch("/api/org/workspace-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editUserId,
          featureGrants: editFeatureGrants,
        }),
      });
      const data = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Failed to save feature access");
        toast.error(msg);
        setEditSaving(false);
        return;
      }
    }

    patchUser(editUserId, patch);
    setEditSaving(false);
    toast.success("User updated");
    closeEdit();
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteRole) {
      toast.error("Email and role are required");
      return;
    }
    setInviteLoading(true);
    try {
      const email = inviteEmail.trim().toLowerCase();
      const res = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = (await res.json()) as {
        error?: unknown;
        emailDelivered?: boolean;
        deliveryNote?: string;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Invite failed");
        throw new Error(msg);
      }
      if (data.emailDelivered) {
        toast.success(`Invitation sent to ${email}`);
      } else {
        toast.message(
          data.deliveryNote ??
            "Invite created, but email delivery failed. Share the invite link from Team.",
        );
      }
      setInviteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviteLoading(false);
    }
  }

  const userOverrides = selectedUser
    ? permissionOverrides.filter((p) => p.userId === selectedUser.id)
    : [];

  const userDept = selectedUser?.departmentId
    ? departments.find((d) => d.id === selectedUser.departmentId)
    : null;

  const managerCandidates = users.filter((u) => u.id !== editUserId);

  return (
    <>
      <PageHeader
        title="Users"
        description="CRM roles, reporting lines, and per-user feature access (without changing role). For logins and invites use Team →"
        actions={
          <div className="flex items-center gap-2">
            <a
              href="/admin/team"
              className="inline-flex h-7 items-center rounded-[12px] bg-secondary px-2.5 text-[0.8rem] font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Team &amp; invites
            </a>
            {canManage ? (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Invite user
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="Only directors, founders, or super admins can invite users">
                <UserPlus className="h-3.5 w-3.5" /> Invite user
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="pl-8 h-8"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v ?? "all")}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {Object.entries(ROLES).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v ?? "all")}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="pip">PIP</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-muted-foreground"
              onClick={clearFilters}
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">Name</TableHead>
                  <TableHead className="h-9">Email</TableHead>
                  <TableHead className="h-9">Role</TableHead>
                  <TableHead className="h-9">Department</TableHead>
                  <TableHead className="h-9">Reports to</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9">Created</TableHead>
                  {canManage && <TableHead className="h-9 w-[72px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const dept = departments.find(
                    (d) => d.id === u.departmentId,
                  );
                  return (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer"
                      onClick={() => {
                        dismissedUrlUserId.current = null;
                        setSelectedUserId(u.id);
                      }}
                    >
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 rounded-full">
                            <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                              {u.displayName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {u.displayName}
                            </div>
                            {u.title && (
                              <div className="text-[11px] text-muted-foreground truncate">
                                {u.title}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground">
                        {u.email}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-medium"
                        >
                          {ROLES[u.roleId]?.label ?? u.roleId}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground">
                        {dept?.name ?? "-"}
                      </TableCell>
                      <TableCell className="py-2">
                        {u.managerId ? (
                          <UserChip userId={u.managerId} size="xs" />
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_TONE[u.status]}`}
                        >
                          {STATUS_LABEL[u.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(u.createdAt, "MMM d, yyyy")}
                      </TableCell>
                      {canManage && (
                        <TableCell className="py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(u);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only sm:not-sr-only sm:ml-1">Edit</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing{" "}
          <span className="tabular-nums font-medium text-foreground">
            {filtered.length}
          </span>{" "}
          of{" "}
          <span className="tabular-nums">{users.length}</span> users
        </div>
      </PageBody>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Invite user
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Email address</Label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                className="h-9"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Display name (optional)</Label>
              <Input
                placeholder="Derived from email if empty"
                className="h-9"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole || undefined} onValueChange={(v) => setInviteRole(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select role">
                    {inviteRole ? INVITE_ORG_ROLE_LABEL[inviteRole] ?? inviteRole : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department (optional)</Label>
              <Select value={inviteDept} onValueChange={(v) => setInviteDept((v as typeof NONE) ?? NONE)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None">
                    {inviteDept === NONE ? "None" : selectTriggerLabelByIdName(inviteDept, departments) ?? "Department"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleInvite} disabled={inviteLoading}>
              {inviteLoading ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user */}
      <Dialog open={editOpen} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit user
            </DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input
                  className="h-9"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  className="h-9"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Job title</Label>
                <Input
                  className="h-9"
                  placeholder="e.g. Senior SDR"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole((v as Role) ?? "salesperson")}>
                  <SelectTrigger className="h-9">
                    <SelectValue>{ROLES[editRole]?.label ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Department</Label>
                <Select value={editDept} onValueChange={(v) => setEditDept(v ?? NONE)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="None">
                      {editDept === NONE ? "None" : selectTriggerLabelByIdName(editDept, departments) ?? "Department"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reports to</Label>
                <Select value={editManager} onValueChange={(v) => setEditManager(v ?? NONE)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="None">
                      {editManager === NONE
                        ? "None"
                        : managerCandidates.find((m) => m.id === editManager)?.displayName ?? "Manager"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {managerCandidates.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={editStatus} onValueChange={(v) => setEditStatus((v as User["status"]) ?? "active")}>
                  <SelectTrigger className="h-9">
                    <SelectValue>{STATUS_LABEL[editStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pip">PIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {canEditFeatureGrants ? (
                <div className="space-y-2 border-t border-border/60 pt-3">
                  <Label className="text-xs font-semibold">Feature access</Label>
                  <FeatureGrantsEditor
                    user={editingUser}
                    value={editFeatureGrants}
                    onChange={setEditFeatureGrants}
                    disabled={editSaving}
                  />
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={closeEdit}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User detail sheet */}
      <Sheet open={sheetUserId != null} onOpenChange={handleUserSheetOpenChange}>
        <SheetContent className="w-full max-w-md overflow-y-auto">
          {selectedUser && (
            <>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 rounded-md">
                    <AvatarFallback className="rounded-md bg-primary/15 text-primary font-semibold">
                      {selectedUser.displayName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-base">
                      {selectedUser.displayName}
                    </SheetTitle>
                    <p className="text-xs text-muted-foreground truncate">
                      {selectedUser.email}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    variant="secondary"
                    onClick={() => openEdit(selectedUser)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit user
                  </Button>
                )}
              </SheetHeader>
              <div className="py-4 space-y-5">
                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Profile
                  </div>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5" /> Role
                      </dt>
                      <dd>
                        <Badge variant="outline" className="text-[10px]">
                          {ROLES[selectedUser.roleId]?.label ?? selectedUser.roleId}
                        </Badge>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" /> Department
                      </dt>
                      <dd className="text-right">
                        {userDept?.name ?? "-"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Manager</dt>
                      <dd>
                        {selectedUser.managerId ? (
                          <UserChip userId={selectedUser.managerId} size="xs" />
                        ) : (
                          "-"
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Status</dt>
                      <dd>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${STATUS_TONE[selectedUser.status]}`}
                        >
                          {STATUS_LABEL[selectedUser.status]}
                        </Badge>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Joined</dt>
                      <dd>{fmtDate(selectedUser.createdAt, "MMM d, yyyy")}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground shrink-0">Extra features</dt>
                      <dd className="text-right text-xs">
                        {featureGrantsSummary(selectedUser)}
                      </dd>
                    </div>
                  </dl>
                </section>

                {userOverrides.length > 0 && (
                  <section className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Permission overrides ({userOverrides.length})
                    </div>
                    <div className="space-y-2">
                      {userOverrides.map((po) => {
                        const scopeDetail = permissionOverrideScopeDetail(
                          po,
                          departments,
                          users,
                          getOwnerDisplayName,
                        );
                        return (
                        <div
                          key={po.id}
                          className="rounded-md border p-3 space-y-1.5 bg-muted/20"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${po.effect === "grant" ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}
                            >
                              {po.effect.toUpperCase()}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {po.resource}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {po.action}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {po.scope}
                            </Badge>
                          </div>
                          {scopeDetail ? (
                            <p className="text-[11px] text-muted-foreground leading-snug">
                              {scopeDetail}
                            </p>
                          ) : null}
                          {po.note && (
                            <p className="text-xs text-muted-foreground">
                              {po.note}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            By{" "}
                            <UserChip
                              userId={po.createdBy}
                              size="xs"
                              nameOnly
                              className="inline-flex"
                              profileHref={`/admin/users?user=${encodeURIComponent(po.createdBy)}`}
                            />{" "}
                            · {fmtRelative(po.createdAt)}
                          </p>
                        </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recent activity
                  </div>
                  <div className="space-y-1.5">
                    {[
                      "Updated lead Forge Robotics → Qualified",
                      "Completed followup with Jordan Harper",
                      "Added note on Northwind Logistics deal",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Users" description="Manage team members, roles, and access." />
          <PageBody>
            <div className="h-40 animate-pulse rounded-md border bg-muted/30" />
          </PageBody>
        </>
      }
    >
      <AdminUsersPageContent />
    </Suspense>
  );
}
