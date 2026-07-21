"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, Plus, Sprout, Upload } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  newProspectingEntityId,
  useProspectingStrategyData,
} from "@/lib/hooks/use-prospecting-strategy-data";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";
import type { ProspectingStrategy } from "@/lib/prospecting-strategy/types";
import { DEFAULT_CHECKLIST } from "@/lib/prospecting-strategy/seed";
import {
  downloadJson,
  emptyStrategyPackTemplate,
  parseStrategyPack,
  slugifyPackId,
} from "@/lib/prospecting-strategy/pack";
import {
  activeAssignmentsForUser,
  allocatedDailyTarget,
  allocationTotal,
} from "@/lib/prospecting-strategy/allocation";
import { countStrategyDayProgress } from "@/lib/prospecting-strategy/progress";
import { UserChip } from "@/components/common/user-chip";

const STATUS_TONE: Record<ProspectingStrategy["status"], string> = {
  draft: "secondary",
  published: "default",
  paused: "outline",
  archived: "secondary",
};

export default function AdminStrategiesPage() {
  const router = useRouter();
  const ws = useWorkspace();
  const data = useProspectingStrategyData();
  const [seeding, setSeeding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const sorted = React.useMemo(
    () =>
      [...data.strategies].sort(
        (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
      ),
    [data.strategies],
  );

  const assignedUsersByStrategy = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of data.assignments) {
      if (a.status !== "active") continue;
      const list = map.get(a.strategyId) ?? [];
      if (!list.includes(a.userId)) list.push(a.userId);
      map.set(a.strategyId, list);
    }
    return map;
  }, [data.assignments]);

  const createBlank = async () => {
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const strategy: ProspectingStrategy = {
        id: newProspectingEntityId("ps"),
        organizationId: data.organizationId,
        name: "Untitled strategy",
        ownerId: ws.currentUserId,
        status: "draft",
        priority: 50,
        personaIds: [],
        firmographics: emptyFirmographics(),
        linkedSignals: [],
        qualityChecklist: DEFAULT_CHECKLIST,
        dailyTargetDefault: 150,
        version: 1,
        createdBy: ws.currentUserId,
        updatedBy: ws.currentUserId,
        createdAt: now,
        updatedAt: now,
      };
      await data.addStrategy(strategy);
      toast.success("Strategy created");
      router.push(`/admin/strategies/${strategy.id}`);
    } catch (e) {
      toast.error("Could not create strategy", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCreating(false);
    }
  };

  const installSample = async () => {
    setSeeding(true);
    try {
      const result = await data.installSamplePack();
      toast.success("Installed sample B2B SaaS pack", {
        description: result.warnings.length
          ? result.warnings.join(" · ")
          : "Neutral demo strategy + personas (new ids).",
      });
      router.push(`/admin/strategies/${result.strategyId}`);
    } catch (e) {
      toast.error("Install failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSeeding(false);
    }
  };

  const downloadTemplate = () => {
    downloadJson("strategy-pack.template.json", emptyStrategyPackTemplate());
    toast.success("Downloaded empty pack template");
  };

  const exportOne = (strategyId: string) => {
    const pack = data.exportStrategyPack(strategyId);
    if (!pack) {
      toast.error("Strategy not found");
      return;
    }
    downloadJson(`${slugifyPackId(pack.name)}.strategy-pack.json`, pack);
    toast.success(`Exported ${pack.name}`);
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON file");
      }
      const parsed = parseStrategyPack(raw);
      if (!parsed.ok) throw new Error(parsed.error);
      const result = await data.importStrategyPack(parsed.pack);
      toast.success(`Imported “${parsed.pack.name}”`, {
        description: result.warnings.length
          ? result.warnings.join(" · ")
          : "Created with new ids for this org.",
      });
      router.push(`/admin/strategies/${result.strategyId}`);
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const managerRows = React.useMemo(() => {
    const userIds = [...new Set(data.assignments.map((a) => a.userId))];
    return userIds.map((userId) => {
      const active = activeAssignmentsForUser(data.assignments, userId);
      const strategies = active
        .map((a) => data.strategies.find((s) => s.id === a.strategyId))
        .filter(Boolean) as ProspectingStrategy[];
      const dailyTarget = active.reduce((sum, a) => {
        const s = data.strategies.find((x) => x.id === a.strategyId);
        return sum + allocatedDailyTarget(a, s?.dailyTargetDefault);
      }, 0);
      const progress = countStrategyDayProgress({
        leads: ws.leads,
        userId,
        strategyAssignmentIds: active.map((assignment) => assignment.id),
        outreachThreshold: ws.intentPlaybook.outreachThreshold,
      });
      const alloc = allocationTotal(active);
      return {
        userId,
        strategies,
        dailyTarget,
        progress,
        alloc,
        assignmentCount: active.length,
      };
    });
  }, [data.assignments, data.strategies, ws.leads, ws.intentPlaybook.outreachThreshold]);

  return (
    <>
      <PageHeader
        title="Prospecting strategies"
        description="Guidance, personas, signal focus, checklists, and assignments — scoring stays in Intent Playbook."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void onImportFile(e.target.files?.[0])}
            />
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Import pack
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="size-4" />
              Pack template
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={seeding}
              onClick={() => void installSample()}
            >
              {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sprout className="size-4" />}
              Install sample pack
            </Button>
            <Button size="sm" type="button" disabled={creating} onClick={() => void createBlank()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              New strategy
            </Button>
          </div>
        }
      />
      <PageBody>
        <Tabs defaultValue="strategies">
          <TabsList>
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
            <TabsTrigger value="performance">Team performance</TabsTrigger>
          </TabsList>

          <TabsContent value="strategies" className="mt-4 space-y-4">
            {data.loading ? (
              <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Loading strategies…
              </p>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">All strategies</CardTitle>
                <CardDescription>
                  Publish a strategy, then assign people with allocation percentages that total
                  100%. Use <strong>Import pack</strong> for private JSON packs (e.g. your Stellix
                  strategies). <strong>Install sample pack</strong> adds a neutral demo only.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sorted.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No strategies yet. Import a pack, install the sample, or create a blank one.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {sorted.map((s) => {
                      const users = assignedUsersByStrategy.get(s.id) ?? [];
                      return (
                        <li
                          key={s.id}
                          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-3 text-sm"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/admin/strategies/${s.id}`}
                                className="font-medium hover:underline truncate"
                              >
                                {s.name}
                              </Link>
                              <Badge variant={STATUS_TONE[s.status] as "default"}>{s.status}</Badge>
                              <Badge variant="outline">v{s.version}</Badge>
                              <Badge variant="outline">{s.dailyTargetDefault}/day</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {s.description || s.objective || "No description"}
                            </p>
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {users.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No assignees</span>
                              ) : (
                                users.slice(0, 6).map((uid) => (
                                  <UserChip key={uid} userId={uid} size="sm" />
                                ))
                              )}
                              {users.length > 6 ? (
                                <span className="text-xs text-muted-foreground">
                                  +{users.length - 6}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() => exportOne(s.id)}
                            >
                              <Download className="size-4" />
                              Export
                            </Button>
                            <Link
                              href={`/admin/strategies/${s.id}`}
                              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                            >
                              Open
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Today by assignee</CardTitle>
                <CardDescription>
                  Progress is derived from prospects created today with strategy attribution.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {managerRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No assignments yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Person</th>
                          <th className="px-3 py-2 font-medium">Strategies</th>
                          <th className="px-3 py-2 font-medium">Alloc %</th>
                          <th className="px-3 py-2 font-medium">Target</th>
                          <th className="px-3 py-2 font-medium">Researched</th>
                          <th className="px-3 py-2 font-medium">Completed</th>
                          <th className="px-3 py-2 font-medium">Qualified</th>
                          <th className="px-3 py-2 font-medium">Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {managerRows.map((row) => {
                          const rate =
                            row.progress.researched > 0
                              ? Math.round(
                                  (row.progress.completed / row.progress.researched) * 100,
                                )
                              : 0;
                          return (
                            <tr key={row.userId}>
                              <td className="px-3 py-2">
                                <UserChip userId={row.userId} size="sm" />
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.strategies.map((s) => s.name).join(", ") || "—"}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={
                                    Math.abs(row.alloc - 100) > 0.5
                                      ? "text-amber-500"
                                      : undefined
                                  }
                                >
                                  {row.alloc}%
                                </span>
                              </td>
                              <td className="px-3 py-2">{row.dailyTarget}</td>
                              <td className="px-3 py-2">{row.progress.researched}</td>
                              <td className="px-3 py-2">
                                {row.progress.completed}/{row.dailyTarget}
                              </td>
                              <td className="px-3 py-2">{row.progress.qualified}</td>
                              <td className="px-3 py-2">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
