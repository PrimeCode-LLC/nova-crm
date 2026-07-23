"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Loader2,
  Play,
  Search,
} from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { MarkdownContent } from "@/components/common/markdown-content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import {
  activeAssignmentsForUser,
  allocatedDailyTarget,
  dailyTargetSource,
  effectiveDailyTarget,
  targetSourceLabel,
} from "@/lib/prospecting-strategy/allocation";
import {
  countStrategyDayProgress,
  countUserDayProgress,
  progressAgainstTargets,
  targetsForStrategy,
} from "@/lib/prospecting-strategy/progress";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import { COMPANY_SIZE_LABELS, REVENUE_RANGES } from "@/lib/constants";

async function copyText(label: string, text: string): Promise<boolean> {
  const t = text.trim();
  if (!t) {
    toast.error(`Nothing to copy (${label})`);
    return false;
  }
  try {
    await navigator.clipboard.writeText(t);
    toast.success(`Copied ${label}`);
    return true;
  } catch {
    toast.error("Could not copy");
    return false;
  }
}

/** Builds a web-search URL. LinkedIn `site:` queries open on Google (handles the operator). */
function searchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function openSearch(query: string) {
  window.open(searchUrl(query), "_blank", "noopener,noreferrer");
}

function CopyChip({
  label,
  value,
  className,
}: {
  label?: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      title={`Click to copy${label ? `: ${label}` : ""}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted transition-colors text-left max-w-full",
        className,
      )}
      onClick={async () => {
        if (await copyText(label ?? "value", value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1000);
        }
      }}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-50" />
      )}
    </button>
  );
}

function CopyAllButton({ label, lines }: { label: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7"
      onClick={() => void copyText(label, lines.join("\n"))}
    >
      <Copy className="size-3.5" />
      Copy all {label}
    </Button>
  );
}

/** Chip list with an inline filter once the list gets long. */
function CopyChipList({
  items,
  label,
  className,
  filterThreshold = 14,
}: {
  items: string[];
  label: string;
  className?: string;
  filterThreshold?: number;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.toLowerCase().includes(q)) : items;

  if (!items.length) {
    return <p className="text-xs text-muted-foreground">Any</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.length > filterThreshold ? (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${items.length} ${label}…`}
            className="h-7 pl-7 text-xs"
          />
        </div>
      ) : null}
      {filtered.length ? (
        <div className="flex flex-wrap gap-1.5">
          {filtered.map((i) => (
            <CopyChip key={i} label={label} value={i} className={className} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No matches for “{query}”.</p>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left text-sm font-medium min-w-0"
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
          {count != null ? (
            <Badge variant="secondary" className="shrink-0">
              {count}
            </Badge>
          ) : null}
        </button>
        {actions ? <div className="flex items-center gap-1 shrink-0">{actions}</div> : null}
      </div>
      {open ? <div className="border-t px-3 py-3 space-y-2">{children}</div> : null}
    </div>
  );
}

const SECTION_DEFAULTS: Record<string, boolean> = {
  mission: true,
  target: true,
  search: true,
  personas: false,
  signals: false,
  checklist: false,
  targets: false,
  sop: false,
};
const SECTION_IDS = Object.keys(SECTION_DEFAULTS);

/** Per-strategy open/closed state for each section, remembered in localStorage. */
function useSectionState(strategyId: string) {
  const storageKey = `my-strategy:sections:${strategyId}`;
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>(SECTION_DEFAULTS);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, boolean>;
          setOpenMap({ ...SECTION_DEFAULTS, ...parsed });
        } else {
          setOpenMap(SECTION_DEFAULTS);
        }
      } catch {
        setOpenMap(SECTION_DEFAULTS);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const persist = React.useCallback(
    (next: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const toggle = React.useCallback(
    (id: string) =>
      setOpenMap((m) => {
        const next = { ...m, [id]: !m[id] };
        persist(next);
        return next;
      }),
    [persist],
  );

  const setAll = React.useCallback(
    (open: boolean) =>
      setOpenMap(() => {
        const next = Object.fromEntries(SECTION_IDS.map((id) => [id, open]));
        persist(next);
        return next;
      }),
    [persist],
  );

  return { openMap, toggle, setAll };
}

export default function MyStrategyPage() {
  const ws = useWorkspace();
  const data = useProspectingStrategyData();
  const quickAdd = useOpenQuickAdd();

  const myAssignments = React.useMemo(() => {
    const active = activeAssignmentsForUser(data.assignments, ws.currentUserId);
    return [...active].sort((a, b) => {
      if (a.assignmentType !== b.assignmentType) {
        return a.assignmentType === "primary" ? -1 : 1;
      }
      return b.priority - a.priority || b.allocationPct - a.allocationPct;
    });
  }, [data.assignments, ws.currentUserId]);

  const [activeAssignmentId, setActiveAssignmentId] = React.useState<string | null>(null);

  const activeAssignment =
    myAssignments.find((a) => a.id === activeAssignmentId) ?? myAssignments[0];
  const activeStrategy = activeAssignment
    ? data.strategies.find((s) => s.id === activeAssignment.strategyId)
    : undefined;

  const dayProgress = React.useMemo(
    () =>
      countUserDayProgress(
        ws.leads,
        ws.currentUserId,
        ws.intentPlaybook.outreachThreshold,
        undefined,
        myAssignments.map((assignment) => assignment.id),
      ),
    [ws.leads, ws.currentUserId, ws.intentPlaybook.outreachThreshold, myAssignments],
  );

  const todayTotal = React.useMemo(() => {
    return myAssignments.reduce((sum, a) => {
      const s = data.strategies.find((x) => x.id === a.strategyId);
      return sum + allocatedDailyTarget(a, s?.dailyTargetDefault);
    }, 0);
  }, [myAssignments, data.strategies]);

  const targets = targetsForStrategy(activeStrategy);
  const remaining = Math.max(0, (todayTotal || targets.completed) - dayProgress.completed);
  const pctComplete =
    (todayTotal || targets.completed) > 0
      ? Math.min(
          100,
          Math.round((dayProgress.completed / (todayTotal || targets.completed)) * 100),
        )
      : 0;

  const startProspecting = (assignment?: StrategyAssignment, strategy?: ProspectingStrategy) => {
    const a = assignment ?? activeAssignment;
    const s = strategy ?? activeStrategy;
    if (!a || !s) return;
    quickAdd.openNewProspectForm({
      source: "my_strategy",
      destination: "/my-strategy",
      prefill: {
        strategyId: s.id,
        strategyAssignmentId: a.id,
        strategyVersion: s.version,
        personaId: (a.personaIdsOverride ?? s.personaIds)?.[0],
      },
    });
  };

  if (data.loading) {
    return (
      <AppPage>
        <PageHeader title="My Strategy" description="Loading…" />
        <PageBody>
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2 py-12">
            <Loader2 className="size-4 animate-spin" /> Loading your strategy…
          </p>
        </PageBody>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHeader
        title="My Strategy"
        description="Workbench for today’s prospecting - switch strategies, copy fields fast, track progress."
        actions={
          activeAssignment && activeStrategy ? (
            <Button size="sm" type="button" onClick={() => startProspecting()}>
              <Play className="size-4" />
              Start prospecting
            </Button>
          ) : null
        }
      />
      <PageBody className="gap-3">
        {myAssignments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <p className="text-sm font-medium">No active strategy assignment</p>
              <p className="text-sm text-muted-foreground">
                Ask a manager to assign you a prospecting strategy.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Compact day strip - stays pinned while scrolling */}
            <div className="sticky top-0 z-20 rounded-lg border bg-card/95 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <span className="text-xs font-medium text-muted-foreground">Today · all strategies</span>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <div>
                <span className="text-muted-foreground">Completed </span>
                <span className="font-semibold tabular-nums">{dayProgress.completed}</span>
                <span className="text-muted-foreground"> / {todayTotal || targets.completed}</span>
              </div>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <div>
                <span className="text-muted-foreground">Left </span>
                <span className="font-semibold tabular-nums">{remaining}</span>
              </div>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <div>
                <span className="text-muted-foreground">Warm/Hot </span>
                <span className="font-semibold tabular-nums">
                  {dayProgress.warm}/{dayProgress.hot}
                </span>
              </div>
              <div className="flex-1 min-w-[120px] max-w-xs">
                <Progress
                  value={pctComplete}
                  className="h-1.5"
                  aria-label={`Daily progress ${pctComplete}%`}
                />
              </div>
              <span className="text-xs text-muted-foreground">{pctComplete}%</span>
            </div>

            {/* Multi-strategy switcher */}
            {myAssignments.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {myAssignments.map((a) => {
                  const s = data.strategies.find((x) => x.id === a.strategyId);
                  const selected = a.id === activeAssignment?.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveAssignmentId(a.id)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-left text-sm transition-colors max-w-full",
                        selected
                          ? "border-primary bg-primary/10"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span className="font-medium line-clamp-1">
                        {s?.name ?? "Strategy"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {a.allocationPct}% · {a.assignmentType} ·{" "}
                        {allocatedDailyTarget(a, s?.dailyTargetDefault)}/day
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeAssignment && activeStrategy ? (
              <StrategyWorkbench
                key={activeStrategy.id}
                assignment={activeAssignment}
                strategy={activeStrategy}
                personas={data.personas}
                leads={ws.leads}
                userId={ws.currentUserId}
                outreachThreshold={ws.intentPlaybook.outreachThreshold}
                playbookSignals={ws.intentPlaybook.signals}
                onStart={() => startProspecting(activeAssignment, activeStrategy)}
                multiStrategy={myAssignments.length > 1}
              />
            ) : null}
          </>
        )}
      </PageBody>
    </AppPage>
  );
}

function StrategyWorkbench({
  assignment,
  strategy,
  personas,
  leads,
  userId,
  outreachThreshold,
  playbookSignals,
  onStart,
  multiStrategy,
}: {
  assignment: StrategyAssignment;
  strategy: ProspectingStrategy;
  personas: BuyerPersona[];
  leads: ReturnType<typeof useWorkspace>["leads"];
  userId: string;
  outreachThreshold: number;
  playbookSignals: { id: string; label: string; points: number; category: string }[];
  onStart: () => void;
  multiStrategy: boolean;
}) {
  const { openMap, toggle, setAll } = useSectionState(strategy.id);
  const allocated = allocatedDailyTarget(assignment, strategy.dailyTargetDefault);
  const source = dailyTargetSource(assignment, strategy.dailyTargetDefault);
  const baseTarget = effectiveDailyTarget(assignment, strategy.dailyTargetDefault);
  const progress = countStrategyDayProgress({
    leads,
    userId,
    strategyId: strategy.id,
    strategyAssignmentId: assignment.id,
    outreachThreshold,
  });
  const targetRows = progressAgainstTargets(progress, targetsForStrategy(strategy));

  const personaIds = assignment.personaIdsOverride?.length
    ? assignment.personaIdsOverride
    : strategy.personaIds;
  const linkedPersonas = personas.filter((p) => personaIds.includes(p.id));

  const industries =
    assignment.industryOverride?.length
      ? assignment.industryOverride
      : strategy.firmographics.targetIndustries;
  const countries =
    assignment.geographyOverride?.length
      ? assignment.geographyOverride
      : strategy.firmographics.targetCountries;
  const regions = strategy.firmographics.targetRegions ?? [];
  const excludedIndustries = strategy.firmographics.excludedIndustries ?? [];
  const requiredKeywords = strategy.firmographics.requiredKeywords ?? [];
  const excludedKeywords = strategy.firmographics.excludedKeywords ?? [];

  const approvedTitles = linkedPersonas.flatMap((p) =>
    p.titles.filter((t) => t.kind === "approved").map((t) => t.title),
  );
  const excludedTitles = linkedPersonas.flatMap((p) =>
    p.titles.filter((t) => t.kind === "excluded").map((t) => t.title),
  );

  const signalDetails = strategy.linkedSignals
    .filter((l) => l.enabled)
    .map((l) => {
      const def = playbookSignals.find((s) => s.id === l.signalId);
      return { ...l, def };
    })
    .sort((a, b) => b.priority - a.priority);

  const sizeLabel = [
    strategy.firmographics.companySizeMin
      ? COMPANY_SIZE_LABELS[strategy.firmographics.companySizeMin]
      : "Any",
    strategy.firmographics.companySizeMax
      ? COMPANY_SIZE_LABELS[strategy.firmographics.companySizeMax]
      : "Any",
  ].join(" – ");

  const revenueLabel =
    strategy.firmographics.revenueMin || strategy.firmographics.revenueMax
      ? [
          strategy.firmographics.revenueMin
            ? REVENUE_RANGES[strategy.firmographics.revenueMin]
            : "Any",
          strategy.firmographics.revenueMax
            ? REVENUE_RANGES[strategy.firmographics.revenueMax]
            : "Any",
        ].join(" – ")
      : null;

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base leading-snug">{strategy.name}</CardTitle>
              <Badge variant="outline">{assignment.assignmentType}</Badge>
              <Badge variant="secondary">{assignment.allocationPct}% of day</Badge>
            </div>
            <CardDescription>
              Daily target for this strategy:{" "}
              <span className="text-foreground font-medium tabular-nums">
                {allocated}
              </span>
              {multiStrategy ? ` of ${baseTarget} base` : ""} - {targetSourceLabel(source)}
            </CardDescription>
          </div>
          <Button size="sm" type="button" className="shrink-0" onClick={onStart}>
            <Play className="size-4" />
            Start prospecting
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
          <Metric label="Researched" value={`${progress.researched}/${allocated}`} />
          <Metric label="Completed" value={`${progress.completed}/${allocated}`} />
          <Metric label="Unique cos" value={String(progress.uniqueCompanies)} />
          <Metric label="Warm / Hot" value={`${progress.warm} / ${progress.hot}`} />
          <Metric label="Rejected" value={String(progress.rejected)} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Quick copy bar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/20 p-2">
          <CopyAllButton label="industries" lines={industries} />
          <CopyAllButton label="countries" lines={countries} />
          {regions.length ? <CopyAllButton label="regions" lines={regions} /> : null}
          <CopyAllButton label="titles" lines={approvedTitles} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void copyText("size range", sizeLabel)}
          >
            <Copy className="size-3.5" />
            Copy size
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setAll(true)}
            >
              <ChevronsUpDown className="size-3.5" />
              Expand all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setAll(false)}
            >
              <ChevronsDownUp className="size-3.5" />
              Collapse all
            </Button>
          </div>
        </div>

        {strategy.missionBlurb ? (
          <CollapsibleSection
            title="Mission - why we prospect"
            open={openMap.mission ?? true}
            onToggle={() => toggle("mission")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => void copyText("mission", strategy.missionBlurb ?? "")}
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            }
          >
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-muted-foreground">
              {strategy.missionBlurb}
            </pre>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          title="Target profile"
          open={openMap.target ?? true}
          onToggle={() => toggle("target")}
          actions={<CopyAllButton label="industries" lines={industries} />}
        >
          {(strategy.description || strategy.objective) && (
            <p className="text-sm text-muted-foreground">
              {strategy.description || strategy.objective}
            </p>
          )}

          <FieldBlock
            label="Industries"
            actions={<CopyAllButton label="industries" lines={industries} />}
          >
            <CopyChipList items={industries} label="industry" />
          </FieldBlock>

          {excludedIndustries.length ? (
            <FieldBlock label="Exclude industries">
              <CopyChipList
                items={excludedIndustries}
                label="excluded industry"
                className="opacity-70"
              />
            </FieldBlock>
          ) : null}

          <FieldBlock
            label="Countries"
            actions={<CopyAllButton label="countries" lines={countries} />}
          >
            <CopyChipList items={countries} label="country" />
          </FieldBlock>

          {regions.length ? (
            <FieldBlock
              label="Priority regions"
              actions={<CopyAllButton label="regions" lines={regions} />}
            >
              <CopyChipList items={regions} label="region" />
            </FieldBlock>
          ) : null}

          <FieldBlock label="Company size">
            <CopyChip label="size" value={sizeLabel} />
          </FieldBlock>

          {revenueLabel ? (
            <FieldBlock label="Revenue">
              <CopyChip label="revenue" value={revenueLabel} />
            </FieldBlock>
          ) : null}

          <FieldBlock label="Outreach threshold">
            <CopyChip label="threshold" value={String(outreachThreshold)} />
          </FieldBlock>

          {requiredKeywords.length ? (
            <FieldBlock
              label="Must mention (keywords)"
              actions={<CopyAllButton label="keywords" lines={requiredKeywords} />}
            >
              <CopyChipList items={requiredKeywords} label="keyword" />
            </FieldBlock>
          ) : null}

          {excludedKeywords.length ? (
            <FieldBlock label="Avoid (keywords)">
              <CopyChipList items={excludedKeywords} label="excluded keyword" className="opacity-70" />
            </FieldBlock>
          ) : null}

          {strategy.firmographics.companyExamples ? (
            <FieldBlock
              label="Good-fit examples"
              actions={
                <CopyButton
                  label="good-fit examples"
                  value={strategy.firmographics.companyExamples}
                />
              }
            >
              <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-sm text-muted-foreground whitespace-pre-wrap">
                {strategy.firmographics.companyExamples}
              </p>
            </FieldBlock>
          ) : null}

          {strategy.firmographics.disqualifiedExamples ? (
            <FieldBlock
              label="Disqualified examples"
              actions={
                <CopyButton
                  label="disqualified examples"
                  value={strategy.firmographics.disqualifiedExamples}
                />
              }
            >
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-sm text-muted-foreground whitespace-pre-wrap">
                {strategy.firmographics.disqualifiedExamples}
              </p>
            </FieldBlock>
          ) : null}

          {strategy.researchNotes ? (
            <FieldBlock
              label="Research notes"
              actions={<CopyButton label="research notes" value={strategy.researchNotes} />}
            >
              <MarkdownContent className="text-muted-foreground">
                {strategy.researchNotes}
              </MarkdownContent>
            </FieldBlock>
          ) : null}
        </CollapsibleSection>

        {strategy.searchTemplates?.length ? (
          <CollapsibleSection
            title="Search templates"
            count={strategy.searchTemplates.length}
            open={openMap.search ?? true}
            onToggle={() => toggle("search")}
          >
            <p className="text-xs text-muted-foreground mb-1">
              Click a query to copy, or hit the search icon to open it in Google. Start with
              signals, not directories.
            </p>
            {strategy.searchTemplates.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t.label}</p>
                  <CopyAllButton label={t.label} lines={t.queries} />
                </div>
                <ul className="space-y-1">
                  {t.queries.map((q) => (
                    <li key={q} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => void copyText("search query", q)}
                        className="flex-1 flex items-start gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs font-mono text-muted-foreground hover:bg-muted/50"
                      >
                        <span className="flex-1 break-all">{q}</span>
                        <Copy className="size-3.5 shrink-0 opacity-60" />
                      </button>
                      <button
                        type="button"
                        title="Open in Google"
                        aria-label="Open search in Google"
                        onClick={() => openSearch(q)}
                        className="flex shrink-0 items-center justify-center rounded-md border bg-background px-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      >
                        <Search className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          title="Personas & titles"
          count={linkedPersonas.length}
          open={openMap.personas ?? false}
          onToggle={() => toggle("personas")}
          actions={<CopyAllButton label="titles" lines={approvedTitles} />}
        >
          {linkedPersonas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No personas linked.</p>
          ) : (
            linkedPersonas.map((p) => <PersonaBlock key={p.id} persona={p} />)
          )}
          {excludedTitles.length ? (
            <FieldBlock label="Excluded titles (do not add)">
              <div className="flex flex-wrap gap-1.5">
                {[...new Set(excludedTitles)].map((t) => (
                  <Badge key={t} variant="outline" className="text-muted-foreground">
                    {t}
                  </Badge>
                ))}
              </div>
            </FieldBlock>
          ) : null}
        </CollapsibleSection>

        <CollapsibleSection
          title="Intent signals"
          count={signalDetails.length}
          open={openMap.signals ?? false}
          onToggle={() => toggle("signals")}
        >
          {signalDetails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signals linked.</p>
          ) : (
            signalDetails.map((s) => (
              <div key={s.signalId} className="rounded-md border px-3 py-2 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.def?.label ?? s.signalId}</span>
                  {s.required ? <Badge variant="destructive">required</Badge> : null}
                  {s.strength ? <Badge variant="outline">{s.strength}</Badge> : null}
                  {s.recencyDays != null ? (
                    <Badge variant="outline">≤ {s.recencyDays}d</Badge>
                  ) : null}
                  {s.def ? <Badge variant="secondary">{s.def.points} pts</Badge> : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 ml-auto"
                    onClick={() =>
                      void copyText(
                        "signal",
                        [
                          s.def?.label ?? s.signalId,
                          s.instructions,
                          s.messageAngle ? `Angle: ${s.messageAngle}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      )
                    }
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                {s.instructions ? (
                  <p className="text-xs text-muted-foreground">{s.instructions}</p>
                ) : null}
                {s.messageAngle ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Angle: </span>
                    {s.messageAngle}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Quality checklist"
          count={strategy.qualityChecklist.filter((c) => c.requirement !== "not_needed").length}
          open={openMap.checklist ?? false}
          onToggle={() => toggle("checklist")}
        >
          {strategy.qualityChecklist
            .filter((c) => c.requirement !== "not_needed")
            .map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium">
                    {c.label}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({c.requirement})
                    </span>
                  </p>
                  {c.instructions ? (
                    <p className="text-xs text-muted-foreground">{c.instructions}</p>
                  ) : null}
                </div>
              </div>
            ))}
        </CollapsibleSection>

        <CollapsibleSection
          title="Today’s targets detail"
          open={openMap.targets ?? false}
          onToggle={() => toggle("targets")}
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {targetRows.map((row) => {
              const ok = row.current >= row.target;
              return (
                <div key={row.key} className="rounded-md border px-3 py-2 text-sm">
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p
                    className={cn(
                      "font-semibold tabular-nums",
                      ok && "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {row.current} / {row.target}
                  </p>
                </div>
              );
            })}
          </div>
          {strategy.industryAllocations?.length ? (
            <div className="pt-1">
              <p className="text-xs text-muted-foreground mb-1.5">Recommended industry mix</p>
              <div className="flex flex-wrap gap-1.5">
                {strategy.industryAllocations.map((a) => (
                  <CopyChip
                    key={a.label}
                    label="industry mix"
                    value={`${a.label}: ${a.target}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </CollapsibleSection>

        {strategy.sopMarkdown ? (
          <CollapsibleSection
            title="Daily process / SOP"
            open={openMap.sop ?? false}
            onToggle={() => toggle("sop")}
            actions={<CopyButton label="SOP" value={strategy.sopMarkdown} />}
          >
            <MarkdownContent>{strategy.sopMarkdown}</MarkdownContent>
          </CollapsibleSection>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Managers edit this strategy in{" "}
          <Link href={`/admin/strategies/${strategy.id}`} className="underline">
            Strategies
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums text-sm">{value}</p>
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7"
      onClick={() => void copyText(label, value)}
    >
      <Copy className="size-3.5" />
      Copy
    </Button>
  );
}

function FieldBlock({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Small labeled group of copyable chips used inside a persona playbook. */
function PlaybookChips({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <CopyChip key={i} label={label} value={i} />
        ))}
      </div>
    </div>
  );
}

function PlaybookText({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <button
      type="button"
      className="w-full space-y-0.5 text-left"
      onClick={() => void copyText(label, value)}
    >
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
        <Copy className="inline size-3 ml-1 opacity-50" />
      </p>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{value}</p>
    </button>
  );
}

function PersonaBlock({ persona }: { persona: BuyerPersona }) {
  const [showPlaybook, setShowPlaybook] = React.useState(false);
  const approved = persona.titles.filter((t) => t.kind === "approved").map((t) => t.title);
  const similar = persona.titles.filter((t) => t.kind === "similar").map((t) => t.title);

  const hasPlaybook =
    persona.painPoints.length > 0 ||
    persona.buyingTriggers.length > 0 ||
    persona.objections.length > 0 ||
    persona.responsibilities.length > 0 ||
    persona.businessGoals.length > 0 ||
    persona.relevantServices.length > 0 ||
    Boolean(persona.valueProposition) ||
    Boolean(persona.callToAction) ||
    Boolean(persona.personalizationNotes) ||
    Boolean(persona.goodExamples) ||
    Boolean(persona.badExamples);

  const copyPlaybook = () => {
    const section = (label: string, items: string[]) =>
      items.length ? `${label}: ${items.join(", ")}` : "";
    const line = (label: string, value?: string) => (value ? `${label}: ${value}` : "");
    const text = [
      persona.name,
      persona.description,
      section("Responsibilities", persona.responsibilities),
      section("Business goals", persona.businessGoals),
      section("Pain points", persona.painPoints),
      section("Buying triggers", persona.buyingTriggers),
      section("Objections", persona.objections),
      section("Relevant services", persona.relevantServices),
      line("Value proposition", persona.valueProposition),
      line("Angle", persona.recommendedAngle),
      line("Call to action", persona.callToAction),
      line("Personalization", persona.personalizationNotes),
    ]
      .filter(Boolean)
      .join("\n");
    void copyText(`${persona.name} playbook`, text);
  };

  return (
    <div className="rounded-md border px-3 py-2 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{persona.name}</p>
          {persona.description ? (
            <p className="text-xs text-muted-foreground line-clamp-2">{persona.description}</p>
          ) : null}
          {(persona.department || persona.seniority) && (
            <p className="text-[11px] text-muted-foreground">
              {[persona.department, persona.seniority].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <CopyAllButton label="titles" lines={approved} />
      </div>

      {approved.length ? (
        <div className="flex flex-wrap gap-1.5">
          {approved.map((t) => (
            <CopyChip key={t} label="title" value={t} />
          ))}
        </div>
      ) : null}
      {similar.length ? (
        <div className="flex flex-wrap gap-1.5">
          {similar.map((t) => (
            <CopyChip key={t} label="similar title" value={t} className="opacity-80" />
          ))}
        </div>
      ) : null}

      {persona.recommendedAngle ? (
        <button
          type="button"
          className="text-xs text-left text-muted-foreground hover:text-foreground w-full"
          onClick={() => void copyText("angle", persona.recommendedAngle ?? "")}
        >
          <span className="font-medium text-foreground">Angle: </span>
          {persona.recommendedAngle}
          <Copy className="inline size-3 ml-1 opacity-50" />
        </button>
      ) : null}

      {hasPlaybook ? (
        <div className="pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={showPlaybook}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowPlaybook((v) => !v)}
            >
              {showPlaybook ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Playbook
            </button>
            {showPlaybook ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6"
                onClick={copyPlaybook}
              >
                <Copy className="size-3.5" />
                Copy playbook
              </Button>
            ) : null}
          </div>
          {showPlaybook ? (
            <div className="mt-2 space-y-2.5 rounded-md bg-muted/20 px-2.5 py-2">
              <PlaybookChips label="Pain points" items={persona.painPoints} />
              <PlaybookChips label="Buying triggers" items={persona.buyingTriggers} />
              <PlaybookChips label="Objections" items={persona.objections} />
              <PlaybookChips label="Responsibilities" items={persona.responsibilities} />
              <PlaybookChips label="Business goals" items={persona.businessGoals} />
              <PlaybookChips label="Relevant services" items={persona.relevantServices} />
              <PlaybookText label="Value proposition" value={persona.valueProposition} />
              <PlaybookText label="Call to action" value={persona.callToAction} />
              <PlaybookText label="Personalization notes" value={persona.personalizationNotes} />
              <PlaybookText label="Good example" value={persona.goodExamples} />
              <PlaybookText label="Avoid" value={persona.badExamples} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
