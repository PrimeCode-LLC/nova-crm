"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  Archive,
  Ban,
  RotateCcw,
  UserX,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { OrgStatusBadge } from "@/components/platform/org-status-badge";
import type { Organization, OrganizationMember } from "@/lib/types";
import { fmtDate, fmtRelative } from "@/lib/format";
import { toast } from "sonner";

const STATUS_HINTS = {
  trial: "Limited access during evaluation.",
  active: "Full access for paying or approved tenants.",
  suspended: "Blocks sign-in and API access until reactivated.",
  archived: "Soft-deleted tenant. Restore to reactivate.",
} as const;

const PLAN_HINTS = {
  free: "Default limits and features.",
  pro: "Higher limits and premium features.",
  enterprise: "Custom limits and support tier.",
} as const;

type DangerAction = "suspend" | "archive" | "restore";

export function OrgDetailClient({ orgId }: { orgId: string }) {
  const router = useRouter();

  const [org, setOrg] = React.useState<Organization | null>(null);
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [membersLoading, setMembersLoading] = React.useState(true);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [status, setStatus] = React.useState<Organization["status"]>("active");
  const [planId, setPlanId] = React.useState<Organization["planId"]>("free");
  const [maxUsers, setMaxUsers] = React.useState("");
  const [billingEmail, setBillingEmail] = React.useState("");
  const [operatorNotes, setOperatorNotes] = React.useState("");
  const [inboundWebhookSecret, setInboundWebhookSecret] = React.useState("");
  const [hasInboundWebhookSecret, setHasInboundWebhookSecret] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [dangerAction, setDangerAction] = React.useState<DangerAction | null>(null);
  const [dangerRunning, setDangerRunning] = React.useState(false);
  const [memberAction, setMemberAction] = React.useState<{
    member: OrganizationMember;
    enable: boolean;
  } | null>(null);

  const loadOrg = React.useCallback(async () => {
    const res = await fetch(`/api/platform/organizations/${orgId}`);
    const data = (await res.json()) as { organization?: Organization; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Not found");
    const o = data.organization;
    if (!o) throw new Error("Not found");
    setOrg(o);
    setName(o.name);
    setSlug(o.slug);
    setStatus(o.status);
    setPlanId(o.planId);
    setMaxUsers(o.maxUsers != null ? String(o.maxUsers) : "");
    setBillingEmail(o.settings.billingEmail ?? "");
    setOperatorNotes(o.settings.operatorNotes ?? "");
    setInboundWebhookSecret("");
    setHasInboundWebhookSecret(Boolean(o.hasInboundWebhookSecret));
  }, [orgId]);

  const loadMembers = React.useCallback(async () => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}/members`);
      const data = (await res.json()) as { members?: OrganizationMember[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load members");
      setMembers(data.members ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setMembersLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadOrg();
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrg]);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const maxParsed = maxUsers.trim() ? parseInt(maxUsers, 10) : null;
      const settings: {
        billingEmail?: string;
        operatorNotes?: string;
        inboundWebhookSecret?: string;
      } = {
        billingEmail: billingEmail.trim() || undefined,
        operatorNotes: operatorNotes.trim() || undefined,
      };
      const trimmedSecret = inboundWebhookSecret.trim();
      if (trimmedSecret) settings.inboundWebhookSecret = trimmedSecret;

      const res = await fetch(`/api/platform/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          status,
          planId,
          maxUsers: maxParsed === null || Number.isNaN(maxParsed) ? null : maxParsed,
          settings,
        }),
      });
      const data = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Save failed");
        throw new Error(msg);
      }
      toast.success("Saved");
      setInboundWebhookSecret("");
      if (trimmedSecret) setHasInboundWebhookSecret(true);
      await loadOrg();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runDangerAction() {
    if (!dangerAction) return;
    setDangerRunning(true);
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}`, {
        method: dangerAction === "archive" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body:
          dangerAction === "archive"
            ? undefined
            : JSON.stringify({
                status: dangerAction === "suspend" ? "suspended" : "active",
              }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Action failed");
      }
      toast.success(
        dangerAction === "archive"
          ? "Organization archived"
          : dangerAction === "suspend"
            ? "Organization suspended"
            : "Organization restored",
      );
      if (dangerAction === "archive") {
        router.push("/platform/organizations");
        return;
      }
      await loadOrg();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setDangerRunning(false);
      setDangerAction(null);
    }
  }

  async function runMemberAction() {
    if (!memberAction) return;
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: memberAction.member.uid,
          status: memberAction.enable ? "active" : "disabled",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success(memberAction.enable ? "Member enabled" : "Member disabled");
      await loadMembers();
      await loadOrg();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setMemberAction(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!org) {
    return (
      <p className="text-sm text-destructive">
        Organization not found.{" "}
        <Link href="/platform/organizations" className="underline">
          Back to list
        </Link>
      </p>
    );
  }

  const displayName = org.name?.trim() || "Unnamed workspace";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/platform/organizations"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Organizations
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{org.id}</p>
          </div>
          <OrgStatusBadge status={org.status} />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Owner</p>
            <p>{org.primaryEmail ?? org.pendingOwnerEmail ?? "Not assigned"}</p>
            {org.pendingOwnerEmail && !org.primaryEmail && (
              <p className="text-xs text-warning">Awaiting sign-up</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Seats</p>
            <p>
              {org.seatsUsed ?? 0}
              {org.maxUsers != null ? ` / ${org.maxUsers}` : " (unlimited cap)"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Created</p>
            <p>{fmtDate(org.createdAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Trial ends</p>
            <p>{org.status === "trial" ? fmtDate(org.trialEndsAt) : "—"}</p>
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(org.id);
                toast.success("Organization ID copied");
              }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy organization ID
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <form onSubmit={onSave} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Workspace</CardTitle>
                <CardDescription>Name and URL identifier for this tenant.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plan & billing</CardTitle>
                <CardDescription>Access tier and internal operator metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{STATUS_HINTS[status]}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Select value={planId} onValueChange={(v) => setPlanId(v as typeof planId)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{PLAN_HINTS[planId]}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxUsers">Max users</Label>
                  <Input
                    id="maxUsers"
                    inputMode="numeric"
                    value={maxUsers}
                    onChange={(e) => setMaxUsers(e.target.value.replace(/\D/g, ""))}
                    placeholder="Unlimited if empty"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing">Billing email</Label>
                  <Input
                    id="billing"
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Operator notes</Label>
                  <Textarea
                    id="notes"
                    value={operatorNotes}
                    onChange={(e) => setOperatorNotes(e.target.value)}
                    rows={3}
                    className="min-h-[4.5rem] resize-y"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Inbound lead webhook secret (per tenant).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Status:{" "}
                  {hasInboundWebhookSecret ? (
                    <span className="text-success">secret configured</span>
                  ) : (
                    <span>not set (falls back to INBOUND_WEBHOOK_SECRET env)</span>
                  )}
                </p>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={inboundWebhookSecret}
                  onChange={(e) => setInboundWebhookSecret(e.target.value)}
                  placeholder="New secret (min 8 characters recommended)"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasInboundWebhookSecret}
                  onClick={() => {
                    void (async () => {
                      try {
                        const res = await fetch(`/api/platform/organizations/${orgId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ settings: { inboundWebhookSecret: "" } }),
                        });
                        if (!res.ok) throw new Error("Failed");
                        setHasInboundWebhookSecret(false);
                        toast.success("Webhook secret cleared");
                      } catch {
                        toast.error("Could not clear secret");
                      }
                    })();
                  }}
                >
                  Clear per-tenant secret
                </Button>
              </CardContent>
            </Card>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Workspace users enrolled in this tenant. Disable to block access without deleting
                data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet.</p>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Joined</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((m) => (
                        <TableRow key={m.uid}>
                          <TableCell>
                            <p className="font-medium">{m.displayName || m.email}</p>
                            <p className="text-xs text-muted-foreground">{m.email}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{m.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={m.status === "active" ? "outline" : "destructive"}
                            >
                              {m.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {fmtRelative(m.joinedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.role !== "owner" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setMemberAction({
                                    member: m,
                                    enable: m.status === "disabled",
                                  })
                                }
                              >
                                {m.status === "disabled" ? (
                                  <>
                                    <UserCheck className="mr-1 h-3.5 w-3.5" />
                                    Enable
                                  </>
                                ) : (
                                  <>
                                    <UserX className="mr-1 h-3.5 w-3.5" />
                                    Disable
                                  </>
                                )}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="mt-4 space-y-4">
          <Card className="border-warning/30">
            <CardHeader>
              <CardTitle className="text-base">Suspend</CardTitle>
              <CardDescription>
                Block all members from signing in. Data is preserved and you can restore later.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                disabled={org.status === "suspended" || org.status === "archived"}
                onClick={() => setDangerAction("suspend")}
              >
                <Ban className="mr-2 h-4 w-4" />
                Suspend organization
              </Button>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base">Archive</CardTitle>
              <CardDescription>
                Soft-delete this tenant. Same as suspend but marked archived in lists. CRM data
                remains in PostgreSQL.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={org.status === "archived"}
                onClick={() => setDangerAction("archive")}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive organization
              </Button>
              {(org.status === "suspended" || org.status === "archived") && (
                <Button type="button" variant="outline" onClick={() => setDangerAction("restore")}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restore to active
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={Boolean(dangerAction)} onOpenChange={(open) => !open && setDangerAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dangerAction === "archive"
                ? "Archive this organization?"
                : dangerAction === "suspend"
                  ? "Suspend this organization?"
                  : "Restore this organization?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {displayName} ({org.slug}) — members will{" "}
              {dangerAction === "restore" ? "regain" : "lose"} access until restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dangerRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={dangerRunning} onClick={() => void runDangerAction()}>
              {dangerRunning ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(memberAction)} onOpenChange={(open) => !open && setMemberAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberAction?.enable ? "Enable member?" : "Disable member?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {memberAction?.member.email} —{" "}
              {memberAction?.enable
                ? "They will regain workspace access."
                : "They will be blocked from the workspace."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runMemberAction()}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
