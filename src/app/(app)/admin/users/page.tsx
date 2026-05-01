"use client";

import * as React from "react";
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
import type { User } from "@/lib/types";
import { Search, UserPlus, Mail, Shield, Building2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_TONE: Record<User["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-transparent",
  pip: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const STATUS_LABEL: Record<User["status"], string> = {
  active: "Active",
  inactive: "Inactive",
  pip: "PIP",
};

export default function AdminUsersPage() {
  const { users, departments, permissionOverrides } = useWorkspace();
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [deptFilter, setDeptFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("");
  const [inviteDept, setInviteDept] = React.useState("");
  const [inviteLoading, setInviteLoading] = React.useState(false);

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

  async function handleInvite() {
    if (!inviteEmail || !inviteRole) {
      toast.error("Email and role are required");
      return;
    }
    setInviteLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setInviteLoading(false);
    toast.success(`Invite sent to ${inviteEmail}`);
    setInviteOpen(false);
    setInviteEmail("");
    setInviteRole("");
    setInviteDept("");
  }

  const userOverrides = selectedUser
    ? permissionOverrides.filter((p) => p.userId === selectedUser.id)
    : [];

  const userDept = selectedUser?.departmentId
    ? departments.find((d) => d.id === selectedUser.departmentId)
    : null;

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage team members, roles, and access."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Invite user
          </Button>
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
                      onClick={() => setSelectedUser(u)}
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
                          {ROLES[u.roleId].label}
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
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? "")}>
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
              <Select value={inviteDept} onValueChange={(v) => setInviteDept(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
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

      {/* User detail sheet */}
      <Sheet
        open={!!selectedUser}
        onOpenChange={(v) => !v && setSelectedUser(null)}
      >
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
                  <div>
                    <SheetTitle className="text-base">
                      {selectedUser.displayName}
                    </SheetTitle>
                    <p className="text-xs text-muted-foreground">
                      {selectedUser.email}
                    </p>
                  </div>
                </div>
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
                          {ROLES[selectedUser.roleId].label}
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
                              className={`text-[10px] ${po.effect === "grant" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}
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
                            By <UserChip userId={po.createdBy} size="xs" nameOnly className="inline-flex" /> · {fmtRelative(po.createdAt)}
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
