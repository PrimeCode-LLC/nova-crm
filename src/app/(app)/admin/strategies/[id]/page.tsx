"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Download, Loader2, Plus, Trash2 } from "lucide-react";

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
  StrategyDailyTargets,
} from "@/lib/prospecting-strategy/types";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import {
  activeAssignmentsForUser,
  allocationTotal,
} from "@/lib/prospecting-strategy/allocation";
import { buildWorkspaceOwnerPickerOptions } from "@/lib/owner-scope";
import { selectTriggerLabelById, capitalizeSelectToken } from "@/lib/base-ui-select-label";
import { COMPANY_SIZES, COMPANY_SIZE_LABELS, REVENUE_RANGES } from "@/lib/constants";
import type { CompanySize, RevenueRange } from "@/lib/types";
import { downloadJson, slugifyPackId } from "@/lib/prospecting-strategy/pack";

const REVENUE_KEYS = Object.keys(REVENUE_RANGES) as RevenueRange[];

const DAILY_TARGET_FIELDS: { key: keyof StrategyDailyTargets; label: string }[] = [
  { key: "completed", label: "Completed / day" },
  { key: "uniqueCompanies", label: "Unique companies" },
  { key: "maxContactsPerCompany", label: "Max contacts / company" },
  { key: "verifiedEmails", label: "Verified emails" },
  { key: "withEvidence", label: "With evidence URL" },
  { key: "withRecentSignal", label: "With recent signal" },
  { key: "warm", label: "Warm" },
  { key: "hot", label: "Hot" },
  { key: "deeplyPersonalized", label: "Deeply personalized" },
];

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Trims free-form editor state so we never persist empty queries, groups, or allocations. */
function normalizeStrategy(s: ProspectingStrategy): ProspectingStrategy {
  const searchTemplates = (s.searchTemplates ?? [])
    .map((t) => ({
      ...t,
      label: t.label.trim() || "Untitled group",
      queries: t.queries.map((q) => q.trim()).filter(Boolean),
    }))
    .filter((t) => t.queries.length > 0);

  const industryAllocations = (s.industryAllocations ?? [])
    .map((a) => ({ label: a.label.trim(), target: Number.isFinite(a.target) ? a.target : 0 }))
    .filter((a) => a.label.length > 0);

  const qualityChecklist = s.qualityChecklist.map((c, i) => ({
    ...c,
    label: c.label.trim() || "Requirement",
    sortOrder: i,
  }));

  return {
    ...s,
    searchTemplates: searchTemplates.length ? searchTemplates : undefined,
    industryAllocations: industryAllocations.length ? industryAllocations : undefined,
    qualityChecklist,
  };
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
      const merged = { ...draft, ...patch, updatedBy: ws.currentUserId, updatedAt: new Date().toISOString() };
      const next = normalizeStrategy(merged);
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

  const addChecklistItem = () => {
    setDraft((d) => {
      if (!d) return d;
      const order = d.qualityChecklist.length;
      return {
        ...d,
        qualityChecklist: [
          ...d.qualityChecklist,
          {
            id: newProspectingEntityId("qc"),
            fieldKey: `custom_${order}`,
            label: "New requirement",
            requirement: "optional",
            sortOrder: order,
          },
        ],
      };
    });
  };

  const removeChecklistItem = (itemId: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            qualityChecklist: d.qualityChecklist
              .filter((c) => c.id !== itemId)
              .map((c, i) => ({ ...c, sortOrder: i })),
          }
        : d,
    );
  };

  const moveChecklistItem = (itemId: string, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const arr = [...d.qualityChecklist];
      const idx = arr.findIndex((c) => c.id === itemId);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= arr.length) return d;
      [arr[idx], arr[swap]] = [arr[swap]!, arr[idx]!];
      return { ...d, qualityChecklist: arr.map((c, i) => ({ ...c, sortOrder: i })) };
    });
  };

  // Search templates
  const addSearchGroup = () => {
    setDraft((d) =>
      d
        ? {
            ...d,
            searchTemplates: [
              ...(d.searchTemplates ?? []),
              { id: newProspectingEntityId("st"), label: "New group", queries: [""] },
            ],
          }
        : d,
    );
  };

  const updateSearchGroupLabel = (groupId: string, label: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            searchTemplates: (d.searchTemplates ?? []).map((t) =>
              t.id === groupId ? { ...t, label } : t,
            ),
          }
        : d,
    );
  };

  const removeSearchGroup = (groupId: string) => {
    setDraft((d) =>
      d
        ? { ...d, searchTemplates: (d.searchTemplates ?? []).filter((t) => t.id !== groupId) }
        : d,
    );
  };

  const updateQuery = (groupId: string, index: number, value: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            searchTemplates: (d.searchTemplates ?? []).map((t) =>
              t.id === groupId
                ? { ...t, queries: t.queries.map((q, i) => (i === index ? value : q)) }
                : t,
            ),
          }
        : d,
    );
  };

  const addQuery = (groupId: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            searchTemplates: (d.searchTemplates ?? []).map((t) =>
              t.id === groupId ? { ...t, queries: [...t.queries, ""] } : t,
            ),
          }
        : d,
    );
  };

  const removeQuery = (groupId: string, index: number) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            searchTemplates: (d.searchTemplates ?? []).map((t) =>
              t.id === groupId
                ? { ...t, queries: t.queries.filter((_, i) => i !== index) }
                : t,
            ),
          }
        : d,
    );
  };

  // Daily targets + industry mix
  const currentTargets = resolveDailyTargets(draft);

  const updateDailyTarget = (key: keyof StrategyDailyTargets, value: number) => {
    setDraft((d) =>
      d ? { ...d, dailyTargets: { ...resolveDailyTargets(d), [key]: value } } : d,
    );
  };

  const addAllocation = () => {
    setDraft((d) =>
      d
        ? { ...d, industryAllocations: [...(d.industryAllocations ?? []), { label: "", target: 0 }] }
        : d,
    );
  };

  const updateAllocation = (
    index: number,
    patch: Partial<{ label: string; target: number }>,
  ) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            industryAllocations: (d.industryAllocations ?? []).map((a, i) =>
              i === index ? { ...a, ...patch } : a,
            ),
          }
        : d,
    );
  };

  const removeAllocation = (index: number) => {
    setDraft((d) =>
      d
        ? { ...d, industryAllocations: (d.industryAllocations ?? []).filter((_, i) => i !== index) }
        : d,
    );
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
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                const pack = data.exportStrategyPack(id);
                if (!pack) {
                  toast.error("Nothing to export");
                  return;
                }
                downloadJson(`${slugifyPackId(pack.name)}.strategy-pack.json`, pack);
                toast.success("Pack exported");
              }}
            >
              <Download className="size-4" />
              Export pack
            </Button>
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
            <TabsTrigger value="search">Search & queries</TabsTrigger>
            <TabsTrigger value="targets">Targets & mix</TabsTrigger>
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
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Mission blurb (pinned on My Strategy)</Label>
                  <Textarea
                    rows={5}
                    value={draft.missionBlurb ?? ""}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, missionBlurb: e.target.value } : d))
                    }
                    placeholder="Four questions, what not to submit, how to start with signals…"
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
                  <Label>Min revenue</Label>
                  <Select
                    value={draft.firmographics.revenueMin ?? "__none__"}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                revenueMin: v === "__none__" ? undefined : (v as RevenueRange),
                              },
                            }
                          : d,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {draft.firmographics.revenueMin
                          ? REVENUE_RANGES[draft.firmographics.revenueMin]
                          : "Any"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      {REVENUE_KEYS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {REVENUE_RANGES[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Max revenue</Label>
                  <Select
                    value={draft.firmographics.revenueMax ?? "__none__"}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              firmographics: {
                                ...d.firmographics,
                                revenueMax: v === "__none__" ? undefined : (v as RevenueRange),
                              },
                            }
                          : d,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {draft.firmographics.revenueMax
                          ? REVENUE_RANGES[draft.firmographics.revenueMax]
                          : "Any"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      {REVENUE_KEYS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {REVENUE_RANGES[r]}
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
                            <div className="space-y-1">
                              <Label className="text-xs">Strength</Label>
                              <Select
                                value={linked.strength ?? "__none__"}
                                onValueChange={(v) =>
                                  updateLinkedSignal(sig.id, {
                                    strength:
                                      v === "__none__"
                                        ? undefined
                                        : (v as "strong" | "medium"),
                                  })
                                }
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue>
                                    {linked.strength
                                      ? capitalizeSelectToken(linked.strength)
                                      : "Not set"}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Not set</SelectItem>
                                  <SelectItem value="strong">Strong</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                </SelectContent>
                              </Select>
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
                            <div className="sm:col-span-3 space-y-1">
                              <Label className="text-xs">Message angle (shown to researcher)</Label>
                              <Textarea
                                rows={2}
                                value={linked.messageAngle ?? ""}
                                onChange={(e) =>
                                  updateLinkedSignal(sig.id, { messageAngle: e.target.value })
                                }
                                placeholder="How Stellix Soft helps when this signal is present…"
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

          <TabsContent value="search" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Search templates</CardTitle>
                <CardDescription>
                  Query groups researchers copy or launch from My Strategy. Start with signals, not
                  directories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(draft.searchTemplates ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No query groups yet.</p>
                ) : (
                  (draft.searchTemplates ?? []).map((group) => (
                    <div key={group.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={group.label}
                          placeholder="Group name (e.g. Facility expansion)"
                          onChange={(e) => updateSearchGroupLabel(group.id, e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive shrink-0"
                          onClick={() => removeSearchGroup(group.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {group.queries.map((q, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              className="font-mono text-xs"
                              value={q}
                              placeholder='"new distribution center" logistics 2026'
                              onChange={(e) => updateQuery(group.id, i, e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive shrink-0"
                              onClick={() => removeQuery(group.id, i)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => addQuery(group.id)}
                        >
                          <Plus className="size-3.5" />
                          Add query
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                <Button type="button" size="sm" variant="outline" onClick={addSearchGroup}>
                  <Plus className="size-4" />
                  Add query group
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="targets" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily targets</CardTitle>
                <CardDescription>
                  Per-metric goals shown in “Today’s targets detail” on My Strategy. Leave the
                  defaults if you only track the single daily total.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {DAILY_TARGET_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label>{field.label}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={currentTargets[field.key]}
                      onChange={(e) =>
                        updateDailyTarget(field.key, Number(e.target.value) || 0)
                      }
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommended industry mix</CardTitle>
                <CardDescription>
                  Suggested split of the daily target across industries (shown as chips).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(draft.industryAllocations ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No industry mix set.</p>
                ) : (
                  (draft.industryAllocations ?? []).map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={a.label}
                        placeholder="Industry group"
                        onChange={(e) => updateAllocation(i, { label: e.target.value })}
                      />
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        value={a.target}
                        onChange={(e) =>
                          updateAllocation(i, { target: Number(e.target.value) || 0 })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive shrink-0"
                        onClick={() => removeAllocation(i)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))
                )}
                <Button type="button" size="sm" variant="outline" onClick={addAllocation}>
                  <Plus className="size-4" />
                  Add industry
                </Button>
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
                {draft.qualityChecklist.map((item, index) => (
                  <div
                    key={item.id}
                    className="grid gap-2 sm:grid-cols-[auto_1fr_140px] items-start rounded-md border px-3 py-2"
                  >
                    <div className="flex sm:flex-col items-center gap-0.5 pt-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        disabled={index === 0}
                        onClick={() => moveChecklistItem(item.id, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        disabled={index === draft.qualityChecklist.length - 1}
                        onClick={() => moveChecklistItem(item.id, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Input
                        className="h-8 text-sm font-medium"
                        value={item.label}
                        placeholder="Requirement label"
                        onChange={(e) => updateChecklistItem(item.id, { label: e.target.value })}
                      />
                      <Input
                        className="h-8 text-xs"
                        placeholder="Instructions for researcher"
                        value={item.instructions ?? ""}
                        onChange={(e) =>
                          updateChecklistItem(item.id, { instructions: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1">
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
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-destructive shrink-0"
                        onClick={() => removeChecklistItem(item.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={addChecklistItem}>
                  <Plus className="size-4" />
                  Add requirement
                </Button>
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
  const [allocationPct, setAllocationPct] = React.useState("50");
  const [targetOverride, setTargetOverride] = React.useState("");
  const [assignmentType, setAssignmentType] = React.useState<"primary" | "secondary">("primary");
  const [editingAllocId, setEditingAllocId] = React.useState<string | null>(null);
  const [editingAllocValue, setEditingAllocValue] = React.useState("");

  const existingOnThisStrategy = React.useMemo(
    () => assignments.find((a) => a.userId === userId && a.status !== "ended"),
    [assignments, userId],
  );

  /** This user's active assignments on other strategies (excluding this strategy's row). */
  const otherActive = React.useMemo(() => {
    if (!userId) return [];
    return activeAssignmentsForUser(data.assignments, userId).filter(
      (a) => a.strategyId !== strategyId && a.id !== existingOnThisStrategy?.id,
    );
  }, [data.assignments, userId, strategyId, existingOnThisStrategy?.id]);

  const othersTotal = allocationTotal(otherActive);
  const thisPct = Number(allocationPct);
  const projectedTotal =
    othersTotal + (Number.isFinite(thisPct) && thisPct > 0 ? thisPct : 0);
  const remainingCap = Math.max(0, 100 - othersTotal);

  const selectUser = (next: string) => {
    setUserId(next);
    const existing = assignments.find((a) => a.userId === next && a.status !== "ended");
    if (existing) {
      setAllocationPct(String(existing.allocationPct));
      setAssignmentType(existing.assignmentType);
      setTargetOverride(
        existing.targetOverride != null ? String(existing.targetOverride) : "",
      );
      return;
    }
    const others = activeAssignmentsForUser(data.assignments, next).filter(
      (a) => a.strategyId !== strategyId,
    );
    const used = allocationTotal(others);
    // First strategy defaults to 50% so you can add more; otherwise suggest remaining capacity.
    const suggest = used === 0 ? 50 : Math.max(1, Math.min(100, 100 - used));
    setAllocationPct(String(suggest));
    setTargetOverride("");
    setAssignmentType(used === 0 ? "primary" : "secondary");
  };

  const add = async () => {
    if (!userId) {
      toast.error("Select a user");
      return;
    }
    const pct = Number(allocationPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("Allocation must be between 1 and 100");
      return;
    }

    const now = new Date().toISOString();
    try {
      if (existingOnThisStrategy) {
        await data.updateAssignment(existingOnThisStrategy.id, {
          assignmentType,
          priority: assignmentType === "primary" ? 100 : 50,
          allocationPct: pct,
          targetOverride: targetOverride.trim() ? Number(targetOverride) : undefined,
          status: "active",
          updatedAt: now,
        });
      } else {
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
        await data.addAssignment(assignment);
      }

      const totalAfter = othersTotal + pct;
      if (Math.abs(totalAfter - 100) <= 0.5) {
        toast.success(existingOnThisStrategy ? "Assignment updated" : "Assignment added");
      } else {
        toast.success(
          existingOnThisStrategy ? "Assignment updated" : "Assignment added",
          {
            description: `This person’s allocations now total ${totalAfter}%. Adjust other strategies until they equal 100%.`,
          },
        );
      }
      setUserId("");
      setAllocationPct("50");
      setTargetOverride("");
    } catch (e) {
      toast.error("Could not assign", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const removeAssignment = async (id: string) => {
    try {
      await data.deleteAssignment(id);
      toast.success("Assignment removed");
    } catch (e) {
      toast.error("Could not remove assignment", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const pauseOrActivate = async (a: StrategyAssignment, status: "active" | "paused") => {
    try {
      await data.updateAssignment(a.id, { status });
      toast.success(status === "paused" ? "Assignment paused" : "Assignment activated");
    } catch (e) {
      toast.error("Could not update assignment", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const saveInlineAlloc = async (a: StrategyAssignment) => {
    const pct = Number(editingAllocValue);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("Allocation must be between 1 and 100");
      return;
    }
    try {
      await data.updateAssignment(a.id, { allocationPct: pct });
      setEditingAllocId(null);
      const userActive = activeAssignmentsForUser(data.assignments, a.userId).map((row) =>
        row.id === a.id ? { ...row, allocationPct: pct } : row,
      );
      const total = allocationTotal(userActive);
      toast.success("Allocation updated", {
        description:
          Math.abs(total - 100) <= 0.5
            ? `${userOptions.find((u) => u.id === a.userId)?.label ?? "User"} totals 100%.`
            : `Person now totals ${total}% across strategies — aim for 100%.`,
      });
    } catch (e) {
      toast.error("Could not update allocation", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /** Per-user totals for people on this strategy (for the balance strip). */
  const balanceByUser = React.useMemo(() => {
    const ids = [...new Set(assignments.map((a) => a.userId))];
    return ids.map((uid) => {
      const active = activeAssignmentsForUser(data.assignments, uid);
      const total = allocationTotal(active);
      return {
        userId: uid,
        label: userOptions.find((u) => u.id === uid)?.label ?? uid,
        total,
        ok: Math.abs(total - 100) <= 0.5,
        count: active.length,
      };
    });
  }, [assignments, data.assignments, userOptions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignments</CardTitle>
        <CardDescription>
          Default daily target: {strategy.dailyTargetDefault}.{" "}
          <strong>Allocation %</strong> is how much of this person’s day goes to each strategy
          (add all strategies first, then tweak until each person totals 100%).{" "}
          <strong>Target override</strong> changes how many prospects/day for this strategy only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How to split someone across strategies</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>On strategy A, assign them at e.g. 50%.</li>
            <li>On strategy B, assign them at 30%.</li>
            <li>On strategy C, assign them at 20%.</li>
            <li>Edit any % in the list until their total is 100% (see balance below).</li>
          </ol>
        </div>

        <div className="grid gap-2 sm:grid-cols-4 items-end rounded-md border p-3">
          <div className="space-y-1.5">
            <Label>User</Label>
            <Select value={userId || undefined} onValueChange={(v) => selectUser(v ?? "")}>
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

          {userId ? (
            <div className="sm:col-span-4 text-xs">
              <span className="text-muted-foreground">
                Other strategies: {othersTotal}% · Remaining capacity: {remainingCap}% · After save:{" "}
              </span>
              <span
                className={
                  Math.abs(projectedTotal - 100) <= 0.5
                    ? "text-emerald-600 dark:text-emerald-400 font-medium"
                    : "text-amber-600 dark:text-amber-400 font-medium"
                }
              >
                {projectedTotal}% total
                {Math.abs(projectedTotal - 100) <= 0.5
                  ? " ✓"
                  : projectedTotal < 100
                    ? ` (${100 - projectedTotal}% still free for other strategies)`
                    : ` (over by ${projectedTotal - 100}% — edit other strategies down)`}
              </span>
            </div>
          ) : null}

          <div className="sm:col-span-4">
            <Button type="button" size="sm" onClick={() => void add()}>
              <Plus className="size-4" />
              {existingOnThisStrategy ? "Update assignment" : "Assign"}
            </Button>
          </div>
        </div>

        {balanceByUser.length > 0 ? (
          <div className="rounded-md border px-3 py-2 space-y-1.5">
            <p className="text-xs font-medium">Allocation balance (all strategies)</p>
            <ul className="space-y-1">
              {balanceByUser.map((row) => (
                <li key={row.userId} className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate">{row.label}</span>
                  <span
                    className={
                      row.ok
                        ? "text-emerald-600 dark:text-emerald-400 shrink-0"
                        : "text-amber-600 dark:text-amber-400 shrink-0"
                    }
                  >
                    {row.total}% across {row.count} strateg{row.count === 1 ? "y" : "ies"}
                    {row.ok ? " ✓" : " — adjust to 100%"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No assignments yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {assignments.map((a) => {
              const userLabel =
                userOptions.find((u) => u.id === a.userId)?.label ?? a.userId;
              const isEditing = editingAllocId === a.id;
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{userLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.assignmentType} ·{" "}
                      {a.targetOverride != null
                        ? `target ${a.targetOverride}/day (override)`
                        : `target ${strategy.dailyTargetDefault}/day`}{" "}
                      · {a.status}
                    </p>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground shrink-0">Alloc %</Label>
                      {isEditing ? (
                        <>
                          <Input
                            className="h-7 w-20"
                            type="number"
                            min={1}
                            max={100}
                            value={editingAllocValue}
                            onChange={(e) => setEditingAllocValue(e.target.value)}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7"
                            onClick={() => void saveInlineAlloc(a)}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setEditingAllocId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-medium">{a.allocationPct}%</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => {
                              setEditingAllocId(a.id);
                              setEditingAllocValue(String(a.allocationPct));
                            }}
                          >
                            Edit %
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {a.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void pauseOrActivate(a, "paused")}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void pauseOrActivate(a, "active")}
                      >
                        Activate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void removeAssignment(a.id)}
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

