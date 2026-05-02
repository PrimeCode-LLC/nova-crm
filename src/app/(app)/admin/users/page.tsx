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
import type { Role, User } from "@/lib/types";
import { canManageOrgUsers } from "@/lib/can-manage-org-users";
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

function titleFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
  } = useWorkspace();

  const viewer = getUserById(currentUserId);
  const canManage = canManageOrgUsers(viewer);

  const [pendingEdits, setPendingEdits] = React.useState<
    Record<string, Partial<Omit<User, "id">>>
  >({});
  const [invitedUsers, setInvitedUsers] = React.useState<User[]>([]);

  const users = React.useMemo(() => {
    const fromWorkspace = wsUsers.map((u) => ({ ...u, ...pendingEdits[u.id] }));
    const fromInvites = canManage
      ? invitedUsers.map((u) => ({ ...u, ...pendingEdits[u.id] }))
      : [];
    return [...fromWorkspace, ...fromInvites];
  }, [wsUsers, invitedUsers, pendingEdits, canManage]);

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
  const [inviteRole, setInviteRole] = React.useState("");
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
    await new Promise((r) => setTimeout(r, 400));
    const patch: Partial<Omit<User, "id">> = {
      displayName: editDisplayName.trim(),
      email,
      title: editTitle.trim() || undefined,
      roleId: editRole,
      departmentId: editDept === NONE ? undefined : editDept,
      managerId: editManager === NONE ? undefined : editManager,
      status: editStatus,
    };
    setPendingEdits((prev) => ({ ...prev, [editUserId]: { ...prev[editUserId], ...patch } }));
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
    await new Promise((r) => setTimeout(r, 600));
    const email = inviteEmail.trim();
    const displayName =
      inviteName.trim() || titleFromEmail(email);
    const newUser: User = {
      id: `u-invited-${Date.now()}`,
      email,
      displayName,
      roleId: inviteRole as Role,
      departmentId: inviteDept === NONE ? undefined : inviteDept,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setInvitedUsers((prev) => [...prev, newUser]);
    setInviteLoading(false);
    toast.success(`Invite sent to ${email}`);
    setInviteOpen(false);
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
        description="Manage team members, roles, and access."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Invite user
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled title="Only directors, founders, or super admins can invite users">
              <UserPlus className="h-3.5 w-3.5" /> Invite user
            </Button>
          )
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
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      <div>
                        <div className="text-sm">{v.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department (optional)</Label>
              <Select value={inviteDept} onValueChange={(v) => setInviteDept((v as typeof NONE) ?? NONE)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None" />
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
                    <SelectValue />
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
                    <SelectValue placeholder="None" />
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
                    <SelectValue placeholder="None" />
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
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pip">PIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  </dl>
                </section>

                {userOverrides.length > 0 && (
                  <section className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Permission overrides ({userOverrides.length})
                    </div>
                    <div className="space-y-2">
                      {userOverrides.map((po) => (
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
                            <Badge variant="outline" className="text-[10px]">
                              {po.scope}
                            </Badge>
                          </div>
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
                      ))}
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
