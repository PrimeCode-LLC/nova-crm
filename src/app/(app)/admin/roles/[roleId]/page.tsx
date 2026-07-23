"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ACTION_META,
  DATA_SCOPE_OPTIONS,
  MODULE_META,
  actionsByGroup,
  modulesByCluster,
  type ActionKey,
  type DataScope,
  type ModuleKey,
  type ModulePermission,
} from "@/lib/permissions/catalog";
import type { WorkspaceRoleDoc } from "@/lib/permissions/role-types";
import { MODULE_BY_HREF } from "@/lib/permissions/catalog";
import { NAV_SECTIONS } from "@/lib/nav";

export default function AdminRoleEditorPage() {
  const params = useParams<{ roleId: string }>();
  const roleId = decodeURIComponent(params.roleId);
  const router = useRouter();

  const [role, setRole] = React.useState<WorkspaceRoleDoc | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [modules, setModules] = React.useState<
    Record<ModuleKey, ModulePermission> | null
  >(null);
  const [actions, setActions] = React.useState<Partial<Record<ActionKey, boolean>>>(
    {},
  );
  const [resetOpen, setResetOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/org/roles/${encodeURIComponent(roleId)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to load role",
        );
      }
      const r = data.role as WorkspaceRoleDoc;
      setRole(r);
      setName(r.name);
      setDescription(r.description ?? "");
      setIsActive(r.isActive);
      setModules(r.modules);
      setActions(r.actions ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load role");
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const sidebarPreview = React.useMemo(() => {
    if (!modules) return [];
    return NAV_SECTIONS.map((section) => ({
      label: section.label,
      items: section.items.filter((item) => {
        const key = MODULE_BY_HREF[item.href];
        if (!key) return true;
        return modules[key]?.view === true;
      }),
    })).filter((s) => s.items.length > 0);
  }, [modules]);

  function patchModule(key: ModuleKey, patch: Partial<ModulePermission>) {
    setModules((prev) => {
      if (!prev) return prev;
      const current = prev[key];
      const next = { ...current, ...patch };
      if (patch.view === false) {
        next.create = false;
        next.edit = false;
        next.delete = false;
        next.scope = "none";
      } else if (patch.view === true && current.scope === "none") {
        next.scope = "own";
      }
      return { ...prev, [key]: next };
    });
  }

  function setClusterView(clusterModules: ModuleKey[], checked: boolean) {
    setModules((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const key of clusterModules) {
        next[key] = {
          ...next[key],
          view: checked,
          create: checked ? next[key].create : false,
          edit: checked ? next[key].edit : false,
          delete: checked ? next[key].delete : false,
          scope: checked
            ? next[key].scope === "none"
              ? "own"
              : next[key].scope
            : "none",
        };
      }
      return next;
    });
  }

  function setGroupActions(groupActions: ActionKey[], checked: boolean) {
    setActions((prev) => {
      const next = { ...prev };
      for (const key of groupActions) next[key] = checked;
      return next;
    });
  }

  async function handleSave() {
    if (!modules) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/org/roles/${encodeURIComponent(roleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          isActive,
          modules,
          actions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to save",
        );
      }
      toast.success("Role saved");
      setRole(data.role);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      const res = await fetch(`/api/org/roles/${encodeURIComponent(roleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to reset",
        );
      }
      toast.success("Reset to system default");
      setResetOpen(false);
      const r = data.role as WorkspaceRoleDoc;
      setRole(r);
      setName(r.name);
      setDescription(r.description ?? "");
      setIsActive(r.isActive);
      setModules(r.modules);
      setActions(r.actions ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading role…</p>
      </PageBody>
    );
  }

  if (!role || !modules) {
    return (
      <>
        <PageHeader title="Role not found" description="This role may have been deleted." />
        <PageBody>
          <Button variant="outline" size="sm" onClick={() => router.push("/admin/roles")}>
            Back to roles
          </Button>
        </PageBody>
      </>
    );
  }

  const clusters = modulesByCluster();
  const groups = actionsByGroup();

  return (
    <>
      <PageHeader
        title={role.name}
        description={
          role.kind === "system"
            ? "System role - edit permissions freely; reset restores catalog defaults."
            : "Custom role - full control over modules and actions."
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/roles" />}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
            {role.kind === "system" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetOpen(true)}
                disabled={saving}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset default
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="capitalize text-[10px]">
            {role.kind}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {role.id}
          </Badge>
        </div>

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="grid gap-4 max-w-lg">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9"
                  disabled={role.kind === "system"}
                />
                {role.kind === "system" ? (
                  <p className="text-[11px] text-muted-foreground">
                    System role names are fixed. Duplicate the role to rename a custom copy.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[80px] text-sm resize-y"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">
                    Inactive roles cannot be assigned to new members.
                  </p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-2 max-w-lg">
              <p className="text-sm font-medium">Sidebar preview</p>
              <p className="text-xs text-muted-foreground">
                Based on module View flags in this draft.
              </p>
              <div className="space-y-3 pt-1">
                {sidebarPreview.map((section) => (
                  <div key={section.label}>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {section.items.map((item) => (
                        <li key={item.href} className="text-sm">
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="modules" className="space-y-6 pt-4">
            {clusters.map((cluster) => (
              <div key={cluster.cluster} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {cluster.label}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setClusterView(cluster.modules, true)}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setClusterView(cluster.modules, false)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="rounded-md border overflow-hidden">
                  <div className="grid grid-cols-[minmax(140px,1.4fr)_repeat(4,minmax(52px,0.5fr))_minmax(100px,0.9fr)] gap-2 bg-muted/30 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Module</span>
                    <span className="text-center">View</span>
                    <span className="text-center">Create</span>
                    <span className="text-center">Edit</span>
                    <span className="text-center">Delete</span>
                    <span>Scope</span>
                  </div>
                  {cluster.modules.map((key) => {
                    const meta = MODULE_META[key];
                    const m = modules[key];
                    const viewOnly = meta.viewOnly;
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(140px,1.4fr)_repeat(4,minmax(52px,0.5fr))_minmax(100px,0.9fr)] gap-2 items-center border-t px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{meta.label}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            {meta.description}
                          </p>
                        </div>
                        {(
                          ["view", "create", "edit", "delete"] as const
                        ).map((cap) => {
                          const notApplicable = Boolean(viewOnly && cap !== "view");
                          return (
                            <div key={cap} className="flex justify-center">
                              {notApplicable ? (
                                <span
                                  className="inline-flex size-4 items-center justify-center rounded-[4px] border border-dashed border-muted-foreground/25 bg-muted/40 text-[10px] leading-none text-muted-foreground/50"
                                  title={`${cap} is not available for ${meta.label}`}
                                  aria-label={`${meta.label} ${cap}: not available`}
                                >
                                  -
                                </span>
                              ) : (
                                <Checkbox
                                  checked={m[cap]}
                                  onCheckedChange={(v) =>
                                    patchModule(key, { [cap]: v === true })
                                  }
                                  aria-label={`${meta.label} ${cap}`}
                                />
                              )}
                            </div>
                          );
                        })}
                        <Select
                          value={m.scope}
                          onValueChange={(v) =>
                            patchModule(key, { scope: (v as DataScope) ?? "own" })
                          }
                          disabled={!m.view}
                        >
                          <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DATA_SCOPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="actions" className="space-y-6 pt-4">
            {groups.map((group) => (
              <div key={group.group} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setGroupActions(group.actions, true)}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setGroupActions(group.actions, false)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  {group.actions.map((key) => {
                    const meta = ACTION_META[key];
                    return (
                      <div key={key} className="flex items-start gap-3">
                        <Checkbox
                          id={`act-${key}`}
                          checked={actions[key] === true}
                          onCheckedChange={(v) =>
                            setActions((prev) => ({ ...prev, [key]: v === true }))
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <Label
                            htmlFor={`act-${key}`}
                            className="text-sm font-medium leading-tight"
                          >
                            {meta.label}
                          </Label>
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </PageBody>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to system default?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current module matrix and actions with the built-in{" "}
              {role.name} preset. Members on this role pick up the change after save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void handleReset()}>
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
