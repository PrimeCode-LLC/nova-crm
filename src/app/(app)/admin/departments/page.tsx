"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useCrmLeadCountsByOwner } from "@/hooks/use-snapshot-crm";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { Users2, Plus } from "lucide-react";
import { toast } from "sonner";

function newTeamId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `team-${crypto.randomUUID()}`;
  }
  return `team-${Date.now()}`;
}

export default function AdminTeamsPage() {
  const router = useRouter();
  const { departments, users, leads, addDepartment, isDemo } = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(isDemo);
  const ownerCounts = useCrmLeadCountsByOwner(snapshotOff && !isDemo);
  const teams = departments;
  const [newOpen, setNewOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setLoading(true);
    const id = newTeamId();
    addDepartment({
      id,
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setLoading(false);
    toast.success(`Team "${name.trim()}" created`);
    setNewOpen(false);
    setName("");
    setDescription("");
    router.push(`/admin/teams/${id}`);
  }

  function openTeam(id: string) {
    router.push(`/admin/teams/${id}`);
  }

  const teamStats = teams.map((team) => ({
    ...team,
    memberCount: users.filter((u) => u.departmentId === team.id).length,
    leadCount: snapshotOff
      ? users
          .filter((u) => u.departmentId === team.id)
          .reduce((sum, u) => sum + (ownerCounts.data?.[u.id] ?? 0), 0)
      : leads.filter((l) =>
          users.find((u) => u.id === l.ownerId)?.departmentId === team.id,
        ).length,
  }));

  return (
    <>
      <PageHeader
        title="Teams"
        description="Optional groups for reporting, targets, and explicit access rules. Reporting lines remain managed in the org chart."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New team
          </Button>
        }
      />
      <PageBody>
        {teamStats.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Users2 className="h-5 w-5" />
            </div>
            <h2 className="mt-3 text-sm font-medium">Teams are optional</h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              Roles and the org chart work without teams. Create one only when you need a stable
              reporting group, target, filter, or explicit team-level access rule.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Create first team
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamStats.map((team) => (
              <Card
                key={team.id}
                role="button"
                tabIndex={0}
                aria-label={`Open team ${team.name}`}
                className="hover:bg-muted/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => openTeam(team.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openTeam(team.id);
                  }
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Users2 className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-sm">{team.name}</CardTitle>
                    </div>
                  </div>
                  {team.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {team.description}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users2 className="h-3.5 w-3.5" />
                      <span className="tabular-nums font-medium text-foreground">
                        {team.memberCount}
                      </span>{" "}
                      member{team.memberCount !== 1 ? "s" : ""}
                    </div>
                    <div className="text-muted-foreground">
                      <span className="tabular-nums font-medium text-foreground">
                        {team.leadCount}
                      </span>{" "}
                      CRM lead{team.leadCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageBody>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users2 className="h-4 w-4" /> New team
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="e.g. Enterprise Sales"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                placeholder="What is this team responsible for?"
                className="h-20 text-sm resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Teams do not create reporting lines or automatically expose CRM records. Use the org
              chart for managers and CRM permissions or Person overrides for access.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={loading}>
              {loading ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
