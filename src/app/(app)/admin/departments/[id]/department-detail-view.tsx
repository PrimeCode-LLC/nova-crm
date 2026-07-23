"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Plus,
  Shield,
  UserMinus,
  Users2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserChip } from "@/components/common/user-chip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { ROLES, roleLabel } from "@/lib/constants";
import {
  MODULE_META,
  type ModuleKey,
} from "@/lib/permissions/catalog";
import { resolveEffectivePermissions } from "@/lib/permissions/can";
import { SYSTEM_ROLE_PRESETS } from "@/lib/permissions/role-presets";
import type { Role } from "@/lib/types";

const NONE = "__none__";

/** Roles that make sense as a team “module pack”. */
const TEAM_ACCESS_ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  {
    value: "salesperson",
    label: ROLES.salesperson.label,
    description: ROLES.salesperson.description,
  },
  {
    value: "prospecting",
    label: ROLES.prospecting.label,
    description: ROLES.prospecting.description,
  },
  {
    value: "content_team",
    label: ROLES.content_team.label,
    description: ROLES.content_team.description,
  },
  {
    value: "team_lead",
    label: ROLES.team_lead.label,
    description: ROLES.team_lead.description,
  },
  {
    value: "manager",
    label: ROLES.manager.label,
    description: ROLES.manager.description,
  },
];

function modulesEnabledByRole(
  roleId: Role | undefined,
  customModules?: Record<ModuleKey, { view: boolean }> | null,
): ModuleKey[] {
  if (!roleId) return [];
  if (customModules) {
    return (Object.keys(MODULE_META) as ModuleKey[]).filter((key) => {
      if (key === "settings_self") return false;
      return customModules[key]?.view === true;
    });
  }
  const snap = resolveEffectivePermissions({ roleId });
  return (Object.keys(MODULE_META) as ModuleKey[]).filter((key) => {
    if (key === "settings_self") return false;
    return snap.modules[key]?.view === true;
  });
}

export function TeamDetailView({ teamId }: { teamId: string }) {
  const ws = useWorkspace();
  const {
    users,
    departments,
    leads,
    patchUser,
    updateDepartment,
    mode,
    currentUserId,
    getUserById,
  } = ws;

  const team = departments.find((candidate) => candidate.id === teamId);
  const viewer = getUserById(currentUserId);
  const canEdit = canManageOrgHierarchy(viewer);

  const [addOpen, setAddOpen] = React.useState(false);
  const [busyUserId, setBusyUserId] = React.useState<string | null>(null);
  const [applyingRole, setApplyingRole] = React.useState(false);
  const [customRoles, setCustomRoles] = React.useState<
    {
      id: string;
      name: string;
      description?: string;
      modules?: Record<ModuleKey, { view: boolean }>;
    }[]
  >([]);

  const members = React.useMemo(
    () => users.filter((u) => u.departmentId === teamId),
    [users, teamId],
  );

  const candidates = React.useMemo(
    () =>
      users
        .filter((u) => u.departmentId !== teamId && u.status !== "inactive")
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users, teamId],
  );

  const leadCount = React.useMemo(() => {
    const ownerIds = new Set(members.map((u) => u.id));
    return leads.filter((l) => ownerIds.has(l.ownerId)).length;
  }, [leads, members]);

  const departmentNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }, [departments]);

  const defaultRoleId = team?.defaultRoleId;
  const customRoleModules = React.useMemo(() => {
    if (!defaultRoleId) return null;
    return customRoles.find((r) => r.id === defaultRoleId)?.modules ?? null;
  }, [customRoles, defaultRoleId]);

  const enabledModules = React.useMemo(
    () => modulesEnabledByRole(defaultRoleId, customRoleModules),
    [defaultRoleId, customRoleModules],
  );

  const roleOptions = React.useMemo(() => {
    const systemIds = new Set(TEAM_ACCESS_ROLE_OPTIONS.map((o) => o.value));
    const extras = customRoles
      .filter((r) => !systemIds.has(r.id as Role))
      .map((r) => ({
        value: r.id as Role,
        label: r.name,
        description: r.description ?? "Custom CRM permission role",
      }));
    return [...TEAM_ACCESS_ROLE_OPTIONS, ...extras];
  }, [customRoles]);

  React.useEffect(() => {
    if (mode !== "live" || !isFirebaseWebConfigured()) return;
    let cancelled = false;
    void fetch("/api/org/roles")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          roles?: {
            id: string;
            name: string;
            description?: string;
            kind?: string;
            modules?: Record<ModuleKey, { view: boolean }>;
          }[];
        };
        if (cancelled) return;
        setCustomRoles(
          (data.roles ?? [])
            .filter((r) => r.kind === "custom")
            .map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description,
              modules: r.modules,
            })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function persistUserPatch(
    userId: string,
    patch: { departmentId?: string | null; roleId?: Role },
  ) {
    setBusyUserId(userId);
    try {
      const writeFs = mode === "live" && isFirebaseWebConfigured();
      if (writeFs) {
        const body: Record<string, unknown> = { userId };
        if ("departmentId" in patch) body.departmentId = patch.departmentId ?? null;
        if (patch.roleId) body.roleId = patch.roleId;

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
              : JSON.stringify(data.error ?? "Update failed");
          toast.error(msg);
          return false;
        }
      }

      const local: Partial<{ departmentId: string | undefined; roleId: Role }> = {};
      if ("departmentId" in patch) local.departmentId = patch.departmentId ?? undefined;
      if (patch.roleId) local.roleId = patch.roleId;
      patchUser(userId, local);
      return true;
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleAdd(userId: string) {
    if (!canEdit || busyUserId) return;
    setAddOpen(false);
    const ok = await persistUserPatch(userId, {
      departmentId: teamId,
      ...(defaultRoleId ? { roleId: defaultRoleId } : {}),
    });
    if (ok) {
      toast.success(
        defaultRoleId
          ? `Added with ${roleLabel(defaultRoleId)} access`
          : mode === "live"
            ? "Added to team"
            : "Added to team (this tab)",
      );
    }
  }

  async function handleRemove(userId: string) {
    if (!canEdit || busyUserId) return;
    const ok = await persistUserPatch(userId, { departmentId: null });
    if (ok) {
      toast.success(mode === "live" ? "Removed from team" : "Removed from team (this tab)");
    }
  }

  function handleDefaultRoleChange(value: string | null) {
    if (!canEdit || !team) return;
    const next = !value || value === NONE ? undefined : (value as Role);
    updateDepartment(teamId, { defaultRoleId: next });
    toast.success(
      next
        ? `Team access set to ${roleLabel(next)}`
        : "Team access role cleared",
    );
  }

  async function applyRoleToMembers() {
    if (!canEdit || !defaultRoleId || members.length === 0 || applyingRole) return;
    setApplyingRole(true);
    let okCount = 0;
    try {
      for (const member of members) {
        if (member.roleId === defaultRoleId) {
          okCount += 1;
          continue;
        }
        const ok = await persistUserPatch(member.id, { roleId: defaultRoleId });
        if (ok) okCount += 1;
      }
      toast.success(
        `Applied ${roleLabel(defaultRoleId)} to ${okCount} member${okCount === 1 ? "" : "s"}`,
      );
    } finally {
      setApplyingRole(false);
    }
  }

  const membersNeedingRole = defaultRoleId
    ? members.filter((m) => m.roleId !== defaultRoleId).length
    : 0;

  if (!team) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Team not found.</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/teams">Back to teams</Link>}
        />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const selectedRoleMeta =
    roleOptions.find((o) => o.value === defaultRoleId) ??
    (defaultRoleId
      ? {
          value: defaultRoleId,
          label: roleLabel(defaultRoleId),
          description:
            defaultRoleId in SYSTEM_ROLE_PRESETS
              ? SYSTEM_ROLE_PRESETS[defaultRoleId as keyof typeof SYSTEM_ROLE_PRESETS]
                  .description
              : undefined,
        }
      : null);

  return (
    <>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <Link href="/admin/teams" aria-label="Back to teams">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Users2 className="h-4 w-4" />
            </div>
            <div>
              <div>{team.name}</div>
              {team.description && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5 max-w-xl">
                  {team.description}
                </p>
              )}
            </div>
          </div>
        }
        description="Assign people and choose which CRM modules this team works in. Fine-grained module toggles live under CRM permissions."
      />

      <PageBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Members</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{members.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                CRM leads owned
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{leadCount}</p>
            </CardContent>
          </Card>
          <Card className="col-span-2 sm:col-span-1">
            <CardContent className="pt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Modules open
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {defaultRoleId ? enabledModules.length : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Module access
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {defaultRoleId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    nativeButton={false}
                    render={
                      <Link href={`/admin/roles/${defaultRoleId}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Edit modules
                      </Link>
                    }
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  nativeButton={false}
                  render={
                    <Link href="/admin/roles">
                      CRM permissions
                    </Link>
                  }
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 max-w-md">
              <p className="text-xs text-muted-foreground">
                Pick the CRM role this team should use. Example: Content team only sees
                calendar; Salesperson sees the sales modules. New members inherit this role
                when you add them.
              </p>
              <Select
                value={defaultRoleId ?? NONE}
                onValueChange={handleDefaultRoleChange}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="No default access role">
                    {defaultRoleId ? roleLabel(defaultRoleId) : "No default access role"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No default access role</SelectItem>
                  {roleOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col gap-0.5 py-0.5">
                        <span>{opt.label}</span>
                        <span className="text-[11px] text-muted-foreground font-normal">
                          {opt.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRoleMeta && (
              <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    {selectedRoleMeta.label}
                    {selectedRoleMeta.description ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        — {selectedRoleMeta.description}
                      </span>
                    ) : null}
                  </p>
                  {canEdit && membersNeedingRole > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={applyingRole || Boolean(busyUserId)}
                      onClick={() => void applyRoleToMembers()}
                    >
                      {applyingRole ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Apply to {membersNeedingRole} member
                      {membersNeedingRole === 1 ? "" : "s"}
                    </Button>
                  )}
                </div>
                {enabledModules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This role does not open any app modules.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {enabledModules.map((key) => (
                      <li key={key}>
                        <Badge variant="secondary" className="font-normal">
                          {MODULE_META[key].label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Everything else stays hidden for people on this role — the rest of the
                  product stays clean for other teams.
                </p>
              </div>
            )}

            {!defaultRoleId && (
              <p className="text-xs text-muted-foreground">
                No team access role yet. Choose one above so sales and content teams only
                see their modules.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users2 className="h-4 w-4 text-muted-foreground" />
                Members ({members.length})
              </CardTitle>
              {canEdit && (
                <Popover open={addOpen} onOpenChange={setAddOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={Boolean(busyUserId) || applyingRole}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add people
                      </Button>
                    }
                  />
                  <PopoverContent className="w-72 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Search people…" />
                      <CommandList>
                        <CommandEmpty>No people found.</CommandEmpty>
                        <CommandGroup heading="Assign to this team">
                          {candidates.map((u) => {
                            const otherTeam =
                              u.departmentId && u.departmentId !== teamId
                                ? departmentNameById.get(u.departmentId)
                                : undefined;
                            return (
                              <CommandItem
                                key={u.id}
                                value={`${u.displayName} ${u.email}`}
                                disabled={busyUserId === u.id}
                                onSelect={() => void handleAdd(u.id)}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm">{u.displayName}</div>
                                  {otherTeam ? (
                                    <div className="truncate text-[11px] text-muted-foreground">
                                      Currently on {otherTeam}
                                    </div>
                                  ) : (
                                    <div className="truncate text-[11px] text-muted-foreground">
                                      {u.email}
                                    </div>
                                  )}
                                </div>
                                {busyUserId === u.id ? (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                ) : null}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {members.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No people assigned to this team.
                {canEdit ? " Use Add people to assign someone." : ""}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {members.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 py-1.5 pl-2 pr-1"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <UserChip userId={u.id} size="sm" />
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {roleLabel(u.roleId)}
                      </Badge>
                    </div>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${u.displayName} from team`}
                        disabled={Boolean(busyUserId) || applyingRole}
                        onClick={() => void handleRemove(u.id)}
                      >
                        {busyUserId === u.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && members.length > 0 && (
              <p className="pt-1 text-[11px] text-muted-foreground flex items-center gap-1.5">
                <UserMinus className="h-3 w-3" />
                Removing someone only clears this team assignment; their CRM role stays until
                you change it.
              </p>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
