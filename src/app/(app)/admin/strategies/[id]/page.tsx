"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  newProspectingEntityId,
  useProspectingStrategyData,
} from "@/lib/hooks/use-prospecting-strategy-data";
import type {
  LinkedPlaybookSignal,
  ProspectingStrategy,
  ProspectingStrategyStatus,
  QualityChecklistItem,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import {
  activeAssignmentsForUser,
  allocationIsValid,
  allocationTotal,
} from "@/lib/prospecting-strategy/allocation";
import { buildWorkspaceOwnerPickerOptions } from "@/lib/owner-scope";
import { selectTriggerLabelById, capitalizeSelectToken } from "@/lib/base-ui-select-label";
import { COMPANY_SIZES, COMPANY_SIZE_LABELS } from "@/lib/constants";
import type { CompanySize } from "@/lib/types";

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function StrategyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const ws = useWorkspace();
  const data = useProspectingStrategyData();
  const strategy = data.strategies.find((s) => s.id === id);

  const [draft, setDraft] = React.useState<ProspectingStrategy | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (strategy) setDraft(structuredClone(strategy));
  }, [strategy]);

  const assignments = React.useMemo(
    () => data.assignments.filter((a) => a.strategyId === id),
    [data.assignments, id],
  );

  const playbookSignals = ws.intentPlaybook.signals ?? [];

  const userOptions = React.useMemo(
    () =>
      buildWorkspaceOwnerPickerOptions(
        ws.users,
        ws.currentUserId,
        ws.getOwnerDisplayName,
      ),
    [ws.users, ws.currentUserId, ws.getOwnerDisplayName],
  );

  if (data.loading && !strategy) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2 py-12">
          <Loader2 className="size-4 animate-spin" /> Loading strategy…
        </p>
      </PageBody>
    );
  }

  if (!strategy || !draft) {
    return (
      <>
        <PageHeader title="Strategy not found" />
        <PageBody>
          <Link
            href="/admin/strategies"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Back to strategies
          </Link>
        </PageBody>
      </>
    );
  }

  const save = async (patch?: Partial<ProspectingStrategy>) => {
    setSaving(true);
    try {
      const next = { ...draft, ...patch, updatedBy: ws.currentUserId, updatedAt: new Date().toISOString() };
      await data.updateStrategy(id, next);
      setDraft(next);
      toast.success("Strategy saved");
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    await save({
      status: "published",
      version:
        draft.status === "published"
          ? draft.version + 1
          : Math.max(1, draft.version || 1),
      publishedAt: new Date().toISOString(),
    });
  };

  const togglePersona = (personaId: string, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const set = new Set(d.personaIds);
      if (on) set.add(personaId);
      else set.delete(personaId);
      return { ...d, personaIds: [...set] };
    });
  };

  const toggleSignal = (signalId: string, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      if (on) {
        if (d.linkedSignals.some((s) => s.signalId === signalId)) return d;
        const link: LinkedPlaybookSignal = {
          signalId,
          enabled: true,
          priority: 50,
          required: false,
          recencyDays: 90,
        };
        return { ...d, linkedSignals: [...d.linkedSignals, link] };
      }
      return { ...d, linkedSignals: d.linkedSignals.filter((s) => s.signalId !== signalId) };
    });
  };

  const updateLinkedSignal = (signalId: string, patch: Partial<LinkedPlaybookSignal>) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        linkedSignals: d.linkedSignals.map((s) =>
          s.signalId === signalId ? { ...s, ...patch } : s,
        ),
      };
    });
  };

  const updateChecklistItem = (itemId: string, patch: Partial<QualityChecklistItem>) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        qualityChecklist: d.qualityChecklist.map((c) =>
          c.id === itemId ? { ...c, ...patch } : c,
        ),
      };
    });
  };

  return (
    <>
      <PageHeader
        title={draft.name}
        description="Edit guidance for researchers. Intent scoring still comes from the org Intent Playbook."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/strategies"
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
            >
              <ArrowLeft className="size-4" />
              Back
            </Link>
            <Select
              value={draft.status}
              onValueChange={(v) =>
                setDraft((d) => (d ? { ...d, status: v as ProspectingStrategyStatus } : d))
              }
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue>{capitalizeSelectToken(draft.status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => void publish()}>
              Publish
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        }
      />
      <PageBody>
        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="company">Company profile</TabsTrigger>
            <TabsTrigger value="personas">Personas</TabsTrigger>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="checklist">Checklist & SOP</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">General</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Short description</Label>
                  <Textarea
                    rows={2}
                    value={draft.description ?? ""}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, description: e.target.value } : d))
                    }
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Business objective</Label>
                  <Textarea
                    rows={2}
                    value={draft.objective ?? ""}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, objective: e.target.value } : d))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Default daily target</Label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.dailyTargetDefault}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? { ...d, dailyTargetDefault: Number(e.target.value) || 0 }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    value={draft.priority}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, priority: Number(e.target.value) || 0 } : d,
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">v{draft.version}</Badge>
                  Linked Intent Playbook: {ws.intentPlaybook.name}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="company" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Target company profile</CardTitle>
                <CardDescription>Firmographics researchers should prioritize.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Target industries</Label>
                  <Textarea
                    rows={3}
                    value={draft.firmographics.targetIndustries.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                targetIndustries: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Excluded industries</Label>
                  <Textarea
                    rows={3}
                    value={draft.firmographics.excludedIndustries.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                excludedIndustries: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Target countries</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.targetCountries.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                targetCountries: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Regions / states</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.targetRegions.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                targetRegions: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Min company size</Label>
                  <Select
                    value={draft.firmographics.companySizeMin ?? "__none__"}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                companySizeMin:
                                  v === "__none__" ? undefined : (v as CompanySize),
                              },
                            }
                          : d,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {draft.firmographics.companySizeMin
                          ? COMPANY_SIZE_LABELS[draft.firmographics.companySizeMin]
                          : "Any"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      {COMPANY_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {COMPANY_SIZE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Max company size</Label>
                  <Select
                    value={draft.firmographics.companySizeMax ?? "__none__"}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                companySizeMax:
                                  v === "__none__" ? undefined : (v as CompanySize),
                              },
                            }
                          : d,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {draft.firmographics.companySizeMax
                          ? COMPANY_SIZE_LABELS[draft.firmographics.companySizeMax]
                          : "Any"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      {COMPANY_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {COMPANY_SIZE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Required keywords</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.requiredKeywords.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                requiredKeywords: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Excluded keywords</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.excludedKeywords.join("\n")}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                excludedKeywords: parseLines(e.target.value),
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Good company examples</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.companyExamples ?? ""}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                companyExamples: e.target.value,
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Disqualified examples</Label>
                  <Textarea
                    rows={2}
                    value={draft.firmographics.disqualifiedExamples ?? ""}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                disqualifiedExamples: e.target.value,
                              },
                            }
                          : d,
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="personas" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Linked personas</CardTitle>
                <CardDescription>
                  Choose buyer personas from the library.{" "}
                  <Link href="/admin/buyer-personas" className="underline">
                    Manage personas
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.personas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No personas yet.</p>
                ) : (
                  data.personas
                    .filter((p) => p.active || draft.personaIds.includes(p.id))
                    .map((p) => (
                      <label
                        key={p.id}
                        className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <Checkbox
                          checked={draft.personaIds.includes(p.id)}
                          onCheckedChange={(v) => togglePersona(p.id, Boolean(v))}
                        />
                        <span className="min-w-0">
                          <span className="font-medium block">{p.name}</span>
                          <span className="text-xs text-muted-foreground line-clamp-2">
                            {p.description ||
                              p.titles
                                .filter((t) => t.kind === "approved")
                                .slice(0, 3)
                                .map((t) => t.title)
                                .join(", ")}
                          </span>
                        </span>
                      </label>
                    ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signals" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Intent signals</CardTitle>
                <CardDescription>
                  Link signals from the org Intent Playbook. Points and scoring stay there — here you
                  add priority, recency, and research instructions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {playbookSignals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No signals in the Intent Playbook yet.
                  </p>
                ) : (
                  playbookSignals.map((sig) => {
                    const linked = draft.linkedSignals.find((l) => l.signalId === sig.id);
                    return (
                      <div key={sig.id} className="rounded-md border px-3 py-2 space-y-2">
                        <label className="flex items-start gap-3 text-sm">
                          <Checkbox
                            checked={Boolean(linked)}
                            onCheckedChange={(v) => toggleSignal(sig.id, Boolean(v))}
                          />
                          <span className="min-w-0">
                            <span className="font-medium">{sig.label}</span>
                            <span className="text-xs text-muted-foreground block">
                              {sig.category} · {sig.points} pts
                              {sig.enabled === false ? " · disabled in playbook" : ""}
                            </span>
                          </span>
                        </label>
                        {linked ? (
                          <div className="grid gap-2 sm:grid-cols-3 pl-8">
                            <div className="space-y-1">
                              <Label className="text-xs">Priority</Label>
                              <Input
                                type="number"
                                value={linked.priority}
                                onChange={(e) =>
                                  updateLinkedSignal(sig.id, {
                                    priority: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Recency (days)</Label>
                              <Input
                                type="number"
                                value={linked.recencyDays ?? ""}
                                onChange={(e) =>
                                  updateLinkedSignal(sig.id, {
                                    recencyDays: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            </div>
                            <div className="flex items-end gap-2 pb-1">
                              <Switch
                                checked={linked.required}
                                onCheckedChange={(v) =>
                                  updateLinkedSignal(sig.id, { required: v })
                                }
                              />
                              <Label className="text-xs">Required signal</Label>
                            </div>
                            <div className="sm:col-span-3 space-y-1">
                              <Label className="text-xs">Research instructions</Label>
                              <Textarea
                                rows={2}
                                value={linked.instructions ?? ""}
                                onChange={(e) =>
                                  updateLinkedSignal(sig.id, { instructions: e.target.value })
                                }
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checklist" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quality checklist</CardTitle>
                <CardDescription>
                  Shown on My Strategy and beside prospect entry. Phase 1 is guidance (warn); hard
                  gates come later.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {draft.qualityChecklist.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-2 sm:grid-cols-[1fr_140px] items-center rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <Input
                        className="mt-1 h-8 text-xs"
                        placeholder="Instructions for researcher"
                        value={item.instructions ?? ""}
                        onChange={(e) =>
                          updateChecklistItem(item.id, { instructions: e.target.value })
                        }
                      />
                    </div>
                    <Select
                      value={item.requirement}
                      onValueChange={(v) =>
                        updateChecklistItem(item.id, {
                          requirement: v as QualityChecklistItem["requirement"],
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue>
                          {item.requirement === "not_needed"
                            ? "Not needed"
                            : capitalizeSelectToken(item.requirement)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="required">Required</SelectItem>
                        <SelectItem value="optional">Optional</SelectItem>
                        <SelectItem value="not_needed">Not needed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">SOP / daily process</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  rows={12}
                  className="font-mono text-xs"
                  value={draft.sopMarkdown ?? ""}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, sopMarkdown: e.target.value } : d))
                  }
                  placeholder="Markdown: daily process, qualification, common mistakes…"
                />
                <div className="space-y-1.5">
                  <Label>Research notes</Label>
                  <Textarea
                    rows={3}
                    value={draft.researchNotes ?? ""}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, researchNotes: e.target.value } : d))
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments" className="mt-4">
            <AssignmentsPanel
              strategyId={id}
              strategy={draft}
              assignments={assignments}
              userOptions={userOptions}
              data={data}
              currentUserId={ws.currentUserId}
            />
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (!confirm("Delete this strategy?")) return;
              void data
                .deleteStrategy(id)
                .then(() => {
                  toast.success("Strategy deleted");
                  router.push("/admin/strategies");
                })
                .catch((e) =>
                  toast.error("Delete failed", {
                    description: e instanceof Error ? e.message : String(e),
                  }),
                );
            }}
          >
            <Trash2 className="size-4" />
            Delete strategy
          </Button>
        </div>
      </PageBody>
    </>
  );
}

function AssignmentsPanel({
  strategyId,
  strategy,
  assignments,
  userOptions,
  data,
  currentUserId,
}: {
  strategyId: string;
  strategy: ProspectingStrategy;
  assignments: StrategyAssignment[];
  userOptions: { id: string; label: string }[];
  data: ReturnType<typeof useProspectingStrategyData>;
  currentUserId: string;
}) {
  const [userId, setUserId] = React.useState("");
  const [allocationPct, setAllocationPct] = React.useState("100");
  const [targetOverride, setTargetOverride] = React.useState("");
  const [assignmentType, setAssignmentType] = React.useState<"primary" | "secondary">("primary");

  const add = async () => {
    if (!userId) {
      toast.error("Select a user");
      return;
    }
    const pct = Number(allocationPct);
    if (!Number.isFinite(pct) || pct <= 0) {
      toast.error("Allocation must be > 0");
      return;
    }
    const existingActive = activeAssignmentsForUser(data.assignments, userId);
    const others = existingActive.filter((a) => a.strategyId !== strategyId);
    const projected = [
      ...others,
      {
        ...({} as StrategyAssignment),
        allocationPct: pct,
        status: "active" as const,
        userId,
      },
    ];
    if (!allocationIsValid(projected)) {
      toast.error("Allocation would exceed 100%", {
        description: `Other active assignments total ${allocationTotal(others)}%. Adjust before adding.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const assignment: StrategyAssignment = {
      id: newProspectingEntityId("sa"),
      organizationId: data.organizationId,
      strategyId,
      userId,
      assignmentType,
      priority: assignmentType === "primary" ? 100 : 50,
      allocationPct: pct,
      targetOverride: targetOverride.trim() ? Number(targetOverride) : undefined,
      status: "active",
      assignedBy: currentUserId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await data.addAssignment(assignment);
      toast.success("Assignment added");
      setUserId("");
      setAllocationPct("100");
      setTargetOverride("");
    } catch (e) {
      toast.error("Could not assign", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignments</CardTitle>
        <CardDescription>
          Default daily target for this strategy: {strategy.dailyTargetDefault}. Active allocations
          per person must total 100%.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4 items-end rounded-md border p-3">
          <div className="space-y-1.5">
            <Label>User</Label>
            <Select
              value={userId || undefined}
              onValueChange={(v) => setUserId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue>
                  {userId ? selectTriggerLabelById(userId, userOptions) : "Select user"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {userOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={assignmentType}
              onValueChange={(v) => setAssignmentType(v as "primary" | "secondary")}
            >
              <SelectTrigger>
                <SelectValue>{capitalizeSelectToken(assignmentType)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Allocation %</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={allocationPct}
              onChange={(e) => setAllocationPct(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Target override</Label>
            <Input
              type="number"
              placeholder={String(strategy.dailyTargetDefault)}
              value={targetOverride}
              onChange={(e) => setTargetOverride(e.target.value)}
            />
          </div>
          <div className="sm:col-span-4">
            <Button type="button" size="sm" onClick={() => void add()}>
              <Plus className="size-4" />
              Assign
            </Button>
          </div>
        </div>

        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No assignments yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {assignments.map((a) => {
              const userLabel =
                userOptions.find((u) => u.id === a.userId)?.label ?? a.userId;
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{userLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.assignmentType} · {a.allocationPct}% ·{" "}
                      {a.targetOverride != null
                        ? `target ${a.targetOverride} (override)`
                        : `target ${strategy.dailyTargetDefault} (strategy)`}{" "}
                      · {a.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {a.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void data.updateAssignment(a.id, { status: "paused" })
                        }
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void data.updateAssignment(a.id, { status: "active" })
                        }
                      >
                        Activate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void data.deleteAssignment(a.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
