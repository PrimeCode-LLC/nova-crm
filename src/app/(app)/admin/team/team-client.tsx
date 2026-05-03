"use client";

import * as React from "react";
import {
  UserPlus,
  Mail,
  Loader2,
  Copy,
  RefreshCw,
  Trash2,
  ShieldCheck,
  XCircle,
  Pencil,
  UserCheck,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtRelative } from "@/lib/format";
import type {
  OrganizationInvite,
  OrganizationMember,
  OrgMemberRole,
} from "@/lib/types";

type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planId: string;
  seatsUsed: number;
  maxUsers: number | null;
  primaryEmail: string | null;
} | null;

const ROLE_OPTIONS: { value: OrgMemberRole; label: string; help: string }[] = [
  { value: "owner", label: "Owner", help: "Full access, billing, ownership transfer" },
  { value: "admin", label: "Admin", help: "Manage team, settings, all data" },
  { value: "manager", label: "Manager", help: "Manage department + reports" },
  { value: "member", label: "Member", help: "Standard CRM user" },
];

const ROLE_RANK: Record<OrgMemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

function randomTempPassword(): string {
  const alphabet =
    "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@%^&*";
  const len = 14;
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! % alphabet.length]!;
  }
  return out;
}

export function TeamPageClient({
  currentUid,
  organization,
  role,
}: {
  currentUid: string;
  organization: OrgSummary;
  role: OrgMemberRole;
}) {
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [invites, setInvites] = React.useState<OrganizationInvite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<OrgMemberRole>("member");
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false);
  const [provisionOpen, setProvisionOpen] = React.useState(false);
  const [provisionEmail, setProvisionEmail] = React.useState("");
  const [provisionDisplayName, setProvisionDisplayName] = React.useState("");
  const [provisionPassword, setProvisionPassword] = React.useState("");
  const [provisionRole, setProvisionRole] =
    React.useState<OrgMemberRole>("member");
  const [provisionSubmitting, setProvisionSubmitting] = React.useState(false);
  const [lastAcceptUrl, setLastAcceptUrl] = React.useState<string | null>(null);
  const [lastDeliveryNote, setLastDeliveryNote] = React.useState<string | null>(
    null,
  );

  const [editMember, setEditMember] = React.useState<OrganizationMember | null>(null);

  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const [m, i] = await Promise.all([
        fetch("/api/org/members", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/org/invites", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setMembers((m.members ?? []) as OrganizationMember[]);
      setInvites((i.invites ?? []) as OrganizationInvite[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Fetch on mount — `refresh` does setState only after the network call returns,
  // which is the canonical "fetch on mount" effect pattern.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteSubmitting(true);
    setLastAcceptUrl(null);
    setLastDeliveryNote(null);
    try {
      const res = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = (await res.json()) as {
        invite?: OrganizationInvite;
        acceptUrl?: string;
        emailDelivered?: boolean;
        deliveryNote?: string;
        error?: unknown;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Invite failed");
        throw new Error(msg);
      }
      if (data.invite) {
        setInvites((prev) => [data.invite!, ...prev]);
      }
      if (data.acceptUrl) setLastAcceptUrl(data.acceptUrl);
      if (data.deliveryNote) setLastDeliveryNote(data.deliveryNote);
      if (data.emailDelivered) {
        toast.success(`Invitation sent to ${inviteEmail.trim()}`);
        setInviteEmail("");
      } else {
        toast.message("Invite created — copy the link to share manually.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function submitProvision(e: React.FormEvent) {
    e.preventDefault();
    if (!provisionEmail.trim() || provisionPassword.length < 8) return;
    setProvisionSubmitting(true);
    try {
      const res = await fetch("/api/org/provision-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: provisionEmail.trim(),
          password: provisionPassword,
          displayName: provisionDisplayName.trim() || undefined,
          role: provisionRole,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        linkedExistingFirebaseUser?: boolean;
        error?: unknown;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Request failed");
        throw new Error(msg);
      }
      if (data.linkedExistingFirebaseUser) {
        toast.success(
          "Existing Firebase account was added to this workspace. Ask them to sign in with their current password.",
        );
      } else {
        toast.success(
          "Login created. Share the email and temporary password securely; they can use “Forgot password” anytime to set a new one.",
        );
      }
      setProvisionOpen(false);
      setProvisionEmail("");
      setProvisionDisplayName("");
      setProvisionPassword("");
      setProvisionRole("member");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setProvisionSubmitting(false);
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite?")) return;
    try {
      const res = await fetch(`/api/org/invites?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setInvites((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: "revoked" } : i)),
      );
      toast.success("Invite revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function patchMember(
    uid: string,
    patch: { role?: OrgMemberRole; status?: "active" | "disabled" },
  ) {
    try {
      const res = await fetch("/api/org/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, ...patch }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Updated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function removeMember(m: OrganizationMember) {
    if (m.uid === currentUid) {
      toast.error("You can't remove yourself.");
      return;
    }
    if (!confirm(`Remove ${m.displayName || m.email} from the workspace?`)) return;
    try {
      const res = await fetch(
        `/api/org/members?uid=${encodeURIComponent(m.uid)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMembers((prev) => prev.filter((x) => x.uid !== m.uid));
      toast.success("Member removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const pendingInvites = invites.filter((i) => i.status === "pending");
  const pendingRequests = members.filter((m) => m.status === "pending");
  const seatLabel =
    organization?.maxUsers != null
      ? `${organization.seatsUsed}/${organization.maxUsers} seats`
      : `${organization?.seatsUsed ?? 0} seats`;

  return (
    <>
      <PageHeader
        title="Team"
        description={
          organization
            ? `Manage members and invites for ${organization.name}.`
            : "Manage members and invites."
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canManage && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProvisionOpen(true)}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Create login
                </Button>
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> Invite
                </Button>
              </>
            )}
          </div>
        }
      />
      <PageBody>
        {organization && (
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {organization.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plan
                </div>
                <div className="mt-1 capitalize">{organization.planId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </div>
                <div className="mt-1 capitalize">{organization.status}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Seats
                </div>
                <div className="mt-1">{seatLabel}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Primary email
                </div>
                <div className="mt-1 truncate">
                  {organization.primaryEmail ?? "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="members" className="space-y-4">
          <TabsList>
            <TabsTrigger value="members">
              Members ({members.filter((m) => m.status !== "pending").length})
            </TabsTrigger>
            <TabsTrigger value="requests">
              Pending requests ({pendingRequests.length})
            </TabsTrigger>
            <TabsTrigger value="invites">
              Pending invites ({pendingInvites.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members">
            {loading ? (
              <div className="h-32 animate-pulse rounded-md border bg-muted/30" />
            ) : members.filter((m) => m.status !== "pending").length === 0 ? (
              <p className="text-sm text-muted-foreground">No active members yet.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members
                      .filter((m) => m.status !== "pending")
                      .map((m) => {
                      const canTouchThisMember =
                        canManage &&
                        m.uid !== currentUid &&
                        // owners can manage anyone; admins can't touch owners or admins
                        (isOwner ||
                          (ROLE_RANK[m.role] < ROLE_RANK[role] &&
                            m.role !== "owner"));
                      return (
                        <TableRow key={m.uid}>
                          <TableCell className="font-medium">
                            {m.displayName || m.email}
                            {m.uid === currentUid && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                you
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.email}
                          </TableCell>
                          <TableCell>
                            {canTouchThisMember ? (
                              <Select
                                value={m.role}
                                onValueChange={(v) =>
                                  void patchMember(m.uid, {
                                    role: v as OrgMemberRole,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.filter((opt) => {
                                    if (opt.value === "owner" && !isOwner) return false;
                                    return true;
                                  }).map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline" className="capitalize">
                                {m.role}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                m.status === "active"
                                  ? "bg-success/10 text-success border-success/20"
                                  : m.status === "disabled"
                                    ? "bg-destructive/10 text-destructive border-destructive/20"
                                    : ""
                              }
                            >
                              {m.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtRelative(m.joinedAt)}
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  onClick={() => setEditMember(m)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span className="sr-only sm:not-sr-only sm:ml-1">View / edit</span>
                                </Button>
                                {canTouchThisMember ? (
                                  <>
                                    {m.status !== "disabled" ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2"
                                        onClick={() =>
                                          void patchMember(m.uid, { status: "disabled" })
                                        }
                                      >
                                        <XCircle className="h-3.5 w-3.5" />
                                        <span className="sr-only sm:not-sr-only sm:ml-1">
                                          Disable
                                        </span>
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2"
                                        onClick={() =>
                                          void patchMember(m.uid, { status: "active" })
                                        }
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        <span className="sr-only sm:not-sr-only sm:ml-1">
                                          Enable
                                        </span>
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-destructive hover:text-destructive"
                                      onClick={() => void removeMember(m)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      <span className="sr-only sm:not-sr-only sm:ml-1">
                                        Remove
                                      </span>
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests">
            {pendingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accounts waiting for approval. Share your organization join link from
                Organization settings so teammates can request access.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Requested</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingRequests.map((m) => (
                      <TableRow key={m.uid}>
                        <TableCell className="font-medium">{m.displayName || m.email}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtRelative(m.joinedAt)}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2"
                                onClick={() => void patchMember(m.uid, { status: "active" })}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-destructive hover:text-destructive"
                                onClick={() => void removeMember(m)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Decline
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="invites">
            {pendingInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending invitations.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Expires</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInvites.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {inv.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtRelative(inv.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtRelative(inv.expiresAt)}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => void revokeInvite(inv.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Revoke
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>

      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Create login (admin)
            </DialogTitle>
            <DialogDescription>
              Creates a Firebase email/password account (or adds an existing account
              to this workspace) and activates them immediately. Share the password
              out-of-band; they can reset it from the login screen.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitProvision} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input
                placeholder="Jordan Harper"
                value={provisionDisplayName}
                onChange={(e) => setProvisionDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={provisionEmail}
                onChange={(e) => setProvisionEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Temporary password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setProvisionPassword(randomTempPassword())}
                >
                  Generate
                </Button>
              </div>
              <Input
                type="text"
                placeholder="8+ characters"
                value={provisionPassword}
                onChange={(e) => setProvisionPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Workspace role</Label>
              <Select
                value={provisionRole}
                onValueChange={(v) => setProvisionRole(v as OrgMemberRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.filter((opt) => {
                    if (opt.value === "owner") return isOwner;
                    if (opt.value === "admin") return isOwner;
                    return true;
                  }).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {opt.help}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setProvisionOpen(false)}
              >
                Close
              </Button>
              <Button type="submit" disabled={provisionSubmitting}>
                {provisionSubmitting && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Create & add to team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Invite teammate
            </DialogTitle>
            <DialogDescription>
              We&apos;ll email an invite link. They&apos;ll set their own password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as OrgMemberRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.filter((opt) => {
                    if (opt.value === "owner") return isOwner;
                    if (opt.value === "admin") return isOwner;
                    return true;
                  }).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {opt.help}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {lastAcceptUrl && (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                <Label className="text-xs">
                  Manual link
                  {lastDeliveryNote && (
                    <span className="ml-2 text-[11px] text-warning">
                      {lastDeliveryNote}
                    </span>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={lastAcceptUrl}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(lastAcceptUrl);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInviteOpen(false)}
              >
                Close
              </Button>
              <Button type="submit" disabled={inviteSubmitting}>
                {inviteSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={editMember !== null} onOpenChange={(o) => !o && setEditMember(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {editMember && (
            <>
              <SheetHeader>
                <SheetTitle>{editMember.displayName || editMember.email}</SheetTitle>
                <SheetDescription>
                  Workspace membership (owner / admin / manager / member). For CRM job roles and
                  permissions, use Users.
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-3 py-4 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Email</div>
                  <div className="mt-0.5">{editMember.email}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">User ID</div>
                  <div className="mt-0.5 font-mono text-xs break-all">{editMember.uid}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Organization role
                  </div>
                  <div className="mt-1.5">
                    {(() => {
                      const canTouchThis =
                        canManage &&
                        editMember.uid !== currentUid &&
                        (isOwner ||
                          (ROLE_RANK[editMember.role] < ROLE_RANK[role] &&
                            editMember.role !== "owner"));
                      return canTouchThis ? (
                        <Select
                          value={editMember.role}
                          onValueChange={(v) => {
                            void patchMember(editMember.uid, {
                              role: v as OrgMemberRole,
                            }).then(() =>
                              setEditMember((prev) =>
                                prev && prev.uid === editMember.uid
                                  ? { ...prev, role: v as OrgMemberRole }
                                  : prev,
                              ),
                            );
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.filter((opt) => {
                              if (opt.value === "owner" && !isOwner) return false;
                              return true;
                            }).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="capitalize">
                          {editMember.role}
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                  <div className="mt-1">
                    <Badge variant="outline" className="capitalize">
                      {editMember.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Joined</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {fmtRelative(editMember.joinedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Invited / source
                  </div>
                  <div className="mt-0.5 font-mono text-xs break-all">{editMember.invitedByUid}</div>
                </div>
              </div>
              <Link
                href="/admin/users"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "inline-flex w-fit",
                )}
              >
                Open Users (CRM roles)
              </Link>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
