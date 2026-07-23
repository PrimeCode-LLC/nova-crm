"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminSubSectionTabs } from "@/lib/admin-sections";
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
  Search,
  X,
  Megaphone,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  FeatureGrantsEditor,
  featureGrantsSummary,
} from "@/components/admin/feature-grants-editor";
import { Button } from "@/components/ui/button";
import { ROLES } from "@/lib/constants";
import { canManageOrgUsers } from "@/lib/can-manage-org-users";
import { canManageFeatureGrants } from "@/lib/can-manage-feature-grants";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { userHasAdminFeature } from "@/lib/admin-feature-access";
import type { RoleListItem } from "@/lib/permissions/role-types";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { selectTriggerLabelByIdName } from "@/lib/base-ui-select-label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtRelative } from "@/lib/format";
import type {
  OrganizationInvite,
  OrganizationMember,
  OrgMemberRole,
  Role,
  User,
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
  { value: "manager", label: "Manager", help: "Manage workspace settings and reporting team" },
  { value: "member", label: "Member", help: "Standard CRM user" },
];

const ROLE_RANK: Record<OrgMemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

const NONE = "__none__" as const;

const CRM_STATUS_TONE: Record<User["status"], string> = {
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-muted text-muted-foreground border-transparent",
  pip: "bg-warning/10 text-warning border-warning/20",
};

const CRM_STATUS_LABEL: Record<User["status"], string> = {
  active: "Active",
  inactive: "Inactive",
  pip: "PIP",
};

const MEMBER_STATUS_TONE: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  disabled: "bg-destructive/10 text-destructive border-destructive/20",
  invited: "bg-warning/10 text-warning border-warning/20",
  pending: "bg-muted text-muted-foreground",
};

const INVITED_BY_SOURCE_LABELS: Record<string, string> = {
  "owner-bootstrap": "Organization founder",
  "platform-seed": "Platform onboarding",
  "open-join-link": "Open join link",
  migration: "Account migration",
};

function memberLabel(m: Pick<OrganizationMember, "displayName" | "email">): string {
  return m.displayName?.trim() || m.email;
}

function memberInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function resolveInvitedBy(
  invitedByUid: string,
  members: OrganizationMember[],
  getOwnerDisplayName: (uid: string) => string | undefined,
): { label: string; personUid?: string } {
  const raw = invitedByUid?.trim();
  if (!raw) return { label: "-" };
  const system = INVITED_BY_SOURCE_LABELS[raw];
  if (system) return { label: system };
  const member = members.find((m) => m.uid === raw);
  if (member) return { label: memberLabel(member), personUid: raw };
  const workspace = getOwnerDisplayName(raw);
  if (workspace) return { label: workspace, personUid: raw };
  return { label: "Unknown user" };
}

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

function PeoplePageClientInner({
  currentUid,
  organization,
  role,
}: {
  currentUid: string;
  organization: OrgSummary;
  role: OrgMemberRole;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const [activeTab, setActiveTab] = React.useState("members");
  React.useEffect(() => {
    const t = searchParams.get("tab");
    if (t && adminSubSectionTabs("/admin/people").includes(t)) setActiveTab(t);
  }, [searchParams]);

  const [editMember, setEditMember] = React.useState<OrganizationMember | null>(null);
  const [editTab, setEditTab] = React.useState<"access" | "profile" | "admin">("access");
  const [query, setQuery] = React.useState("");
  const [workspaceRoleFilter, setWorkspaceRoleFilter] = React.useState("all");
  const [crmRoleFilter, setCrmRoleFilter] = React.useState("all");

  const [editDisplayName, setEditDisplayName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editTitle, setEditTitle] = React.useState("");
  const [editCrmRole, setEditCrmRole] = React.useState<Role>("salesperson");
  const [editDept, setEditDept] = React.useState<string>(NONE);
  const [editManager, setEditManager] = React.useState<string>(NONE);
  const [editCrmStatus, setEditCrmStatus] = React.useState<User["status"]>("active");
  const [editFeatureGrants, setEditFeatureGrants] = React.useState<AdminFeatureKey[]>([]);
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [orgRoles, setOrgRoles] = React.useState<RoleListItem[]>([]);

  const dismissedUrlPerson = React.useRef<string | null>(null);

  const {
    getOwnerDisplayName,
    getUserById,
    users: wsUsers,
    departments,
    currentUserId,
    patchUser,
    mode,
    isDemo,
  } = useWorkspace();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/org/roles");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.roles)) {
          setOrgRoles(
            (data.roles as RoleListItem[]).filter((r) => r.isActive !== false),
          );
        }
      } catch {
        // Fall back to built-in ROLES labels when catalog is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const crmRoleOptions = React.useMemo(() => {
    if (orgRoles.length > 0) {
      return orgRoles.map((r) => ({
        value: r.id as Role,
        label: r.name,
      }));
    }
    return Object.entries(ROLES)
      .filter(([k]) => k !== "data_scraper")
      .map(([k, v]) => ({ value: k as Role, label: v.label }));
  }, [orgRoles]);

  function crmRoleLabel(roleId: string | undefined): string {
    if (!roleId) return "-";
    const fromOrg = orgRoles.find((r) => r.id === roleId);
    if (fromOrg) return fromOrg.name;
    if (roleId in ROLES) return ROLES[roleId as keyof typeof ROLES].label;
    return roleId;
  }

  const viewer = getUserById(currentUserId);
  const canManageCrm = canManageOrgUsers(viewer);
  const canEditFeatureGrants = canManageFeatureGrants(viewer);

  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const urlPersonParam = searchParams.get("person") ?? searchParams.get("user");
  const urlPersonId =
    urlPersonParam && members.some((m) => m.uid === urlPersonParam)
      ? urlPersonParam
      : urlPersonParam && wsUsers.some((u) => u.id === urlPersonParam)
        ? urlPersonParam
        : null;

  React.useEffect(() => {
    if (!urlPersonId) dismissedUrlPerson.current = null;
    else if (dismissedUrlPerson.current && dismissedUrlPerson.current !== urlPersonId) {
      dismissedUrlPerson.current = null;
    }
  }, [urlPersonId]);

  React.useEffect(() => {
    if (!urlPersonId || dismissedUrlPerson.current === urlPersonId || editMember) return;
    const member = members.find((m) => m.uid === urlPersonId);
    if (member && member.status !== "pending") {
      setEditMember(member);
      setEditTab("profile");
    }
  }, [urlPersonId, members, editMember]);

  function openMember(m: OrganizationMember, tab: "access" | "profile" | "admin" = "access") {
    dismissedUrlPerson.current = null;
    setEditTab(tab);
    setEditMember(m);
  }

  function closeMemberDialog(open: boolean) {
    if (!open) {
      if (urlPersonId) dismissedUrlPerson.current = urlPersonId;
      setEditMember(null);
      if (searchParams.get("person") || searchParams.get("user")) {
        router.replace("/admin/people", { scroll: false });
      }
    }
  }

  const crmUserForEdit = editMember ? getUserById(editMember.uid) : null;

  React.useEffect(() => {
    if (!editMember) return;
    const u = getUserById(editMember.uid);
    if (u) {
      setEditDisplayName(u.displayName);
      setEditEmail(u.email);
      setEditTitle(u.title ?? "");
      setEditCrmRole(u.roleId);
      setEditDept(u.departmentId ?? NONE);
      setEditManager(u.managerId ?? NONE);
      setEditCrmStatus(u.status);
      setEditFeatureGrants(u.featureGrants ?? []);
    } else {
      setEditDisplayName(editMember.displayName?.trim() || "");
      setEditEmail(editMember.email);
      setEditTitle("");
      setEditCrmRole("salesperson");
      setEditDept(NONE);
      setEditManager(NONE);
      setEditCrmStatus("active");
      setEditFeatureGrants([]);
    }
    // Reload when the dialog opens for a member - not on every roster refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getUserById
  }, [editMember]);

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

  // Fetch on mount - `refresh` does setState only after the network call returns,
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
        toast.message("Invite created, copy the link to share manually.");
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
        credentials: "same-origin",
        body: JSON.stringify({
          email: provisionEmail.trim(),
          password: provisionPassword,
          displayName: provisionDisplayName.trim() || undefined,
          role: provisionRole,
        }),
      });
      const raw = await res.text();
      let data: {
        ok?: boolean;
        linkedExistingFirebaseUser?: boolean;
        error?: unknown;
      } = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          throw new Error(
            res.status === 404
              ? "This action is not on the server yet (404). Deploy the latest app build so /api/org/provision-login is available."
              : res.status >= 500
                ? `Server error (HTTP ${res.status}). Check deployment logs.`
                : `Unexpected response from server (HTTP ${res.status}).`,
          );
        }
      } else if (!res.ok) {
        throw new Error(
          `Request failed (HTTP ${res.status}) with an empty response. Deploy the latest build or check server logs.`,
        );
      }
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

  async function toggleCreateCampaignGrant(uid: string, enable: boolean) {
    const crm = getUserById(uid);
    if (!crm) {
      toast.error("Add a CRM profile for this person first.");
      return;
    }
    const current = crm.featureGrants ?? [];
    const next = enable
      ? ([...new Set([...current, "create_campaigns" as AdminFeatureKey])] as AdminFeatureKey[])
      : current.filter((g) => g !== "create_campaigns");

    const writeGrantsLive =
      canEditFeatureGrants && mode === "live" && !isDemo && isFirebaseWebConfigured();
    if (writeGrantsLive) {
      try {
        const res = await fetch("/api/org/workspace-users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, featureGrants: next }),
        });
        const data = (await res.json()) as { error?: unknown };
        if (!res.ok) {
          const msg =
            typeof data.error === "string"
              ? data.error
              : JSON.stringify(data.error ?? "Failed to update campaign permission");
          throw new Error(msg);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
        return;
      }
    }

    patchUser(uid, { featureGrants: next.length ? next : undefined });
    toast.success(enable ? "Can create campaigns" : "Campaign creation revoked");
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

  async function handleSaveFeatureGrants() {
    if (!editMember || !canEditFeatureGrants) return;
    setProfileSaving(true);
    const writeGrantsLive = mode === "live" && !isDemo && isFirebaseWebConfigured();
    if (writeGrantsLive) {
      const res = await fetch("/api/org/workspace-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editMember.uid,
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
        setProfileSaving(false);
        return;
      }
    }

    patchUser(editMember.uid, {
      featureGrants: editFeatureGrants.length ? editFeatureGrants : undefined,
    });
    setProfileSaving(false);
    toast.success("Admin access saved");
  }

  async function handleSaveProfile() {
    if (!editMember || !canManageCrm) return;
    const email = editEmail.trim();
    const displayName = editDisplayName.trim();
    if (!displayName || !email) {
      toast.error("Name and email are required");
      return;
    }

    const crm = getUserById(editMember.uid);
    const nextDept = editDept === NONE ? undefined : editDept;
    const nextManager = editManager === NONE ? undefined : editManager;
    const nextTitle = editTitle.trim() || undefined;

    const patch: Partial<Omit<User, "id">> = {
      displayName,
      email,
      title: nextTitle,
      roleId: editCrmRole,
      departmentId: nextDept,
      managerId: nextManager,
      status: editCrmStatus,
      featureGrants: editFeatureGrants.length ? editFeatureGrants : undefined,
    };

    setProfileSaving(true);
    try {
      const writeLive = mode === "live" && !isDemo && isFirebaseWebConfigured();
      if (writeLive) {
        const body: Record<string, unknown> = { userId: editMember.uid };

        if (displayName !== (crm?.displayName ?? editMember.displayName ?? "")) {
          body.displayName = displayName;
        }
        if (email.toLowerCase() !== (crm?.email ?? editMember.email).toLowerCase()) {
          body.email = email;
        }
        if ((nextTitle ?? null) !== (crm?.title ?? null)) {
          body.title = nextTitle ?? null;
        }
        if (editCrmStatus !== (crm?.status ?? "active")) {
          body.status = editCrmStatus;
        }
        if (nextDept !== (crm?.departmentId ?? undefined)) {
          body.departmentId = nextDept ?? null;
        }
        if (nextManager !== (crm?.managerId ?? undefined)) {
          body.managerId = nextManager ?? null;
        }
        if (editMember.uid !== currentUserId && editCrmRole !== crm?.roleId) {
          body.roleId = editCrmRole;
        }
        if (canEditFeatureGrants) {
          const prevGrants = [...(crm?.featureGrants ?? [])].sort().join(",");
          const nextGrants = [...editFeatureGrants].sort().join(",");
          if (prevGrants !== nextGrants) {
            body.featureGrants = editFeatureGrants;
          }
        }

        if (Object.keys(body).length <= 1) {
          toast.message("No changes to save");
          return;
        }

        const res = await fetch("/api/org/workspace-users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: unknown };
        if (!res.ok) {
          const msg =
            typeof data.error === "string"
              ? data.error
              : JSON.stringify(data.error ?? "Failed to save profile");
          toast.error(msg);
          return;
        }
      }

      patchUser(editMember.uid, patch);
      toast.success(writeLive ? "Profile saved" : "Profile saved (this tab)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  const activeMembers = members.filter((m) => m.status !== "pending");
  const filteredMembers = activeMembers.filter((m) => {
    const q = query.toLowerCase().trim();
    const crm = getUserById(m.uid);
    const matchQuery =
      !q ||
      memberLabel(m).toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q);
    const matchWorkspace =
      workspaceRoleFilter === "all" || m.role === workspaceRoleFilter;
    const matchCrm =
      crmRoleFilter === "all" || (crm?.roleId ?? "") === crmRoleFilter;
    return matchQuery && matchWorkspace && matchCrm;
  });

  const hasActiveFilters =
    query.trim() !== "" ||
    workspaceRoleFilter !== "all" ||
    crmRoleFilter !== "all";

  function clearFilters() {
    setQuery("");
    setWorkspaceRoleFilter("all");
    setCrmRoleFilter("all");
  }

  const managerCandidates = wsUsers.filter((u) => u.id !== editMember?.uid);
  const pendingInvites = invites.filter((i) => i.status === "pending");
  const pendingRequests = members.filter((m) => m.status === "pending");
  const seatLabel =
    organization?.maxUsers != null
      ? `${organization.seatsUsed}/${organization.maxUsers} seats`
      : `${organization?.seatsUsed ?? 0} seats`;

  return (
    <>
      <PageHeader
        title="People"
        description={
          organization
            ? `Manage access to ${organization.name}, CRM permissions, reporting lines, optional teams, and admin tools.`
            : "Workspace access, CRM profiles, reporting lines, and permissions in one place."
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
                  {organization.primaryEmail ?? "-"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="members">
              People ({activeMembers.length})
            </TabsTrigger>
            <TabsTrigger value="requests">
              Pending requests ({pendingRequests.length})
            </TabsTrigger>
            <TabsTrigger value="invites">
              Pending invites ({pendingInvites.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-3">
            {loading ? (
              <div className="h-32 animate-pulse rounded-md border bg-muted/30" />
            ) : activeMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No people in this workspace yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] max-w-sm flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search people…"
                      className="h-8 pl-8"
                    />
                  </div>
                  <Select
                    value={workspaceRoleFilter}
                    onValueChange={(v) => setWorkspaceRoleFilter(v ?? "all")}
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue placeholder="Workspace access" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All workspace access</SelectItem>
                      {ROLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={crmRoleFilter} onValueChange={(v) => setCrmRoleFilter(v ?? "all")}>
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue placeholder="CRM permissions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All CRM permissions</SelectItem>
                      {crmRoleOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasActiveFilters ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-muted-foreground"
                      onClick={clearFilters}
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  ) : null}
                </div>
              <div className="overflow-hidden rounded-md border">
                <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Workspace access</TableHead>
                      <TableHead>CRM permissions</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>CRM status</TableHead>
                      <TableHead>Joined</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.map((m) => {
                      const crm = getUserById(m.uid);
                      const dept = crm?.departmentId
                        ? departments.find((d) => d.id === crm.departmentId)
                        : null;
                      const canTouchThisMember =
                        canManage &&
                        m.uid !== currentUid &&
                        // owners can manage anyone; admins can't touch owners or admins
                        (isOwner ||
                          (ROLE_RANK[m.role] < ROLE_RANK[role] &&
                            m.role !== "owner"));
                      const hasCreateCampaignGrant = crm
                        ? userHasAdminFeature(crm, "create_campaigns", m.role)
                        : false;
                      const showCampaignGrantToggle =
                        canEditFeatureGrants &&
                        canTouchThisMember &&
                        m.role === "member" &&
                        Boolean(crm);
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
                          <TableCell className="text-sm text-muted-foreground">
                            {crm ? (
                              <Badge variant="outline" className="text-[10px] font-medium">
                                {crmRoleLabel(crm.roleId)}
                              </Badge>
                            ) : (
                              <span className="text-xs">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {dept?.name ?? "-"}
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
                          <TableCell>
                            {crm ? (
                              <Badge
                                variant="outline"
                                className={`text-[10px] capitalize ${CRM_STATUS_TONE[crm.status]}`}
                              >
                                {CRM_STATUS_LABEL[crm.status]}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {fmtRelative(m.joinedAt)}
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  onClick={() => openMember(m)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span className="sr-only sm:not-sr-only sm:ml-1">View / edit</span>
                                </Button>
                                {showCampaignGrantToggle ? (
                                  <TooltipProvider delay={300}>
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className={cn(
                                              "h-7 px-2",
                                              hasCreateCampaignGrant &&
                                                "text-primary hover:text-primary",
                                            )}
                                            onClick={() =>
                                              void toggleCreateCampaignGrant(
                                                m.uid,
                                                !hasCreateCampaignGrant,
                                              )
                                            }
                                          >
                                            <Megaphone className="h-3.5 w-3.5" />
                                            <span className="sr-only sm:not-sr-only sm:ml-1">
                                              {hasCreateCampaignGrant
                                                ? "Revoke campaigns"
                                                : "Allow campaigns"}
                                            </span>
                                          </Button>
                                        }
                                      />
                                      <TooltipContent side="top">
                                        {hasCreateCampaignGrant
                                          ? "Revoke permission to create outreach campaigns"
                                          : "Allow this member to create outreach campaigns"}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : null}
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
              </div>
                <p className="text-xs text-muted-foreground">
                  Showing{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {filteredMembers.length}
                  </span>{" "}
                  of{" "}
                  <span className="tabular-nums">{activeMembers.length}</span> people
                </p>
              </>
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
                      <TableHead>Workspace access</TableHead>
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
              <Label className="text-xs">Workspace access</Label>
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

      <Dialog open={editMember !== null} onOpenChange={closeMemberDialog}>
        <DialogContent className="flex max-h-[min(90vh,720px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          {editMember && (() => {
            const displayName = memberLabel(editMember);
            const invitedBy = resolveInvitedBy(
              editMember.invitedByUid,
              members,
              getOwnerDisplayName,
            );
            const crmUser = crmUserForEdit;
            const canTouchAccess =
              canManage &&
              editMember.uid !== currentUid &&
              (isOwner ||
                (ROLE_RANK[editMember.role] < ROLE_RANK[role] &&
                  editMember.role !== "owner"));

            return (
              <>
                <DialogHeader className="space-y-0 border-b px-4 pb-3 pt-4 text-left">
                  <div className="flex items-start gap-3 pr-8">
                    <Avatar className="h-10 w-10 shrink-0 rounded-md">
                      <AvatarFallback className="rounded-md bg-primary/15 text-primary text-sm font-semibold">
                        {memberInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <DialogTitle className="text-base leading-snug">{displayName}</DialogTitle>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {editMember.email}
                      </p>
                      {editMember.uid === currentUid ? (
                        <Badge variant="outline" className="mt-2 text-[10px]">
                          You
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </DialogHeader>

                <Tabs
                  value={editTab}
                  onValueChange={(v) =>
                    setEditTab((v as "access" | "profile" | "admin") ?? "access")
                  }
                  className="flex min-h-0 flex-1 flex-col overflow-hidden px-4"
                >
                  <TabsList className="mx-0 mt-3 w-full shrink-0">
                    <TabsTrigger value="access" className="flex-1 text-xs">
                      Access
                    </TabsTrigger>
                    <TabsTrigger value="profile" className="flex-1 text-xs">
                      CRM profile
                    </TabsTrigger>
                    {canEditFeatureGrants ? (
                      <TabsTrigger value="admin" className="flex-1 text-xs">
                        Admin tools
                      </TabsTrigger>
                    ) : null}
                  </TabsList>

                  <TabsContent
                    value="access"
                    className="mt-0 flex-1 space-y-4 overflow-y-auto py-4 text-sm"
                  >
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Controls sign-in, billing seats, and who can manage workspace settings.
                    </p>
                    <dl className="space-y-2.5">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">Workspace access</dt>
                        <dd className="min-w-0 text-right">
                          {canTouchAccess ? (
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
                              <SelectTrigger className="h-8 w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.filter((opt) => {
                                  if (opt.value === "owner" && !isOwner) return false;
                                  if (opt.value === "admin" && !isOwner) return false;
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
                              {ROLE_OPTIONS.find((o) => o.value === editMember.role)?.label ??
                                editMember.role}
                            </Badge>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-muted-foreground">Account status</dt>
                        <dd>
                          <Badge
                            variant="outline"
                            className={cn(
                              "capitalize",
                              MEMBER_STATUS_TONE[editMember.status] ?? "",
                            )}
                          >
                            {editMember.status}
                          </Badge>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-muted-foreground">Joined</dt>
                        <dd className="text-muted-foreground">{fmtRelative(editMember.joinedAt)}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">Invited by</dt>
                        <dd className="min-w-0 text-right">
                          {invitedBy.personUid ? (
                            <UserChip
                              userId={invitedBy.personUid}
                              size="xs"
                              className="inline-flex justify-end"
                              profileHref={`/admin/people?person=${encodeURIComponent(invitedBy.personUid)}`}
                            />
                          ) : (
                            <span>{invitedBy.label}</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    {canTouchAccess ? (
                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        {editMember.status !== "disabled" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void patchMember(editMember.uid, { status: "disabled" })}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Disable account
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void patchMember(editMember.uid, { status: "active" })}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Re-enable account
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void removeMember(editMember)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove from workspace
                        </Button>
                      </div>
                    ) : null}
                  </TabsContent>

                  <TabsContent
                    value="profile"
                    className="mt-0 flex-1 space-y-3 overflow-y-auto py-4"
                  >
                    {!crmUser && !canManageCrm ? (
                      <p className="text-sm text-muted-foreground">
                        No CRM profile yet. An admin can assign CRM permissions after they join.
                      </p>
                    ) : (
                      <div className="space-y-3 pr-1">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Display name</Label>
                          <Input
                            className="h-9"
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            disabled={!canManageCrm}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Email</Label>
                          <Input
                            type="email"
                            className="h-9"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            disabled={!canManageCrm}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Job title</Label>
                          <Input
                            className="h-9"
                            placeholder="e.g. Senior SDR"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            disabled={!canManageCrm}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">CRM permissions</Label>
                          <Select
                            value={editCrmRole}
                            onValueChange={(v) => setEditCrmRole((v as Role) ?? "salesperson")}
                            disabled={!canManageCrm}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue>{crmRoleLabel(editCrmRole)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {crmRoleOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Team (optional)</Label>
                          <Select
                            value={editDept}
                            onValueChange={(v) => setEditDept(v ?? NONE)}
                            disabled={!canManageCrm}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="None">
                                {editDept === NONE
                                  ? "None"
                                  : selectTriggerLabelByIdName(editDept, departments) ?? "Team"}
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
                          <Select
                            value={editManager}
                            onValueChange={(v) => setEditManager(v ?? NONE)}
                            disabled={!canManageCrm}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="None">
                                {editManager === NONE
                                  ? "None"
                                  : managerCandidates.find((m) => m.id === editManager)
                                      ?.displayName ?? "Manager"}
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
                          <Label className="text-xs">CRM status</Label>
                          <Select
                            value={editCrmStatus}
                            onValueChange={(v) =>
                              setEditCrmStatus((v as User["status"]) ?? "active")
                            }
                            disabled={!canManageCrm}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue>{CRM_STATUS_LABEL[editCrmStatus]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                              <SelectItem value="pip">PIP</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {crmUser ? (
                          <p className="text-[11px] text-muted-foreground">
                            Extra admin tools: {featureGrantsSummary(crmUser)}
                          </p>
                        ) : null}
                      </div>
                    )}
                    {canManageCrm ? (
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        disabled={profileSaving}
                        onClick={() => void handleSaveProfile()}
                      >
                        {profileSaving ? "Saving…" : "Save CRM profile"}
                      </Button>
                    ) : null}
                  </TabsContent>

                  {canEditFeatureGrants ? (
                    <TabsContent
                      value="admin"
                      className="mt-0 flex-1 space-y-3 overflow-y-auto py-4"
                    >
                      {crmUser ? (
                        <>
                          <FeatureGrantsEditor
                            user={crmUser}
                            value={editFeatureGrants}
                            onChange={setEditFeatureGrants}
                            disabled={profileSaving}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="w-full"
                            disabled={profileSaving}
                            onClick={() => void handleSaveFeatureGrants()}
                          >
                            {profileSaving ? "Saving…" : "Save admin access"}
                          </Button>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Save a CRM profile first, then you can grant admin tools here.
                        </p>
                      )}
                    </TabsContent>
                  ) : null}
                </Tabs>

                <div className="shrink-0 border-t px-4 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-center text-xs text-muted-foreground"
                    onClick={() => {
                      void navigator.clipboard.writeText(editMember.uid);
                      toast.success("User ID copied");
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy user ID
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PeoplePageClient(
  props: Parameters<typeof PeoplePageClientInner>[0],
) {
  return (
    <Suspense
      fallback={
        <div className="h-48 animate-pulse rounded-md border bg-muted/30 m-6" />
      }
    >
      <PeoplePageClientInner {...props} />
    </Suspense>
  );
}
