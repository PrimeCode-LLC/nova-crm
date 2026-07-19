"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Play, CheckCircle2 } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import {
  activeAssignmentsForUser,
  allocatedDailyTarget,
  dailyTargetSource,
  effectiveDailyTarget,
  targetSourceLabel,
} from "@/lib/prospecting-strategy/allocation";
import { countStrategyDayProgress, countUserDayProgress } from "@/lib/prospecting-strategy/progress";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import type { BuyerPersona, ProspectingStrategy, StrategyAssignment } from "@/lib/prospecting-strategy/types";
import { COMPANY_SIZE_LABELS } from "@/lib/constants";

export default function MyStrategyPage() {
  const ws = useWorkspace();
  const data = useProspectingStrategyData();
  const quickAdd = useOpenQuickAdd();

  const myAssignments = React.useMemo(
    () => activeAssignmentsForUser(data.assignments, ws.currentUserId),
    [data.assignments, ws.currentUserId],
  );

  const primary = React.useMemo(() => {
    const sorted = [...myAssignments].sort((a, b) => {
      if (a.assignmentType !== b.assignmentType) {
        return a.assignmentType === "primary" ? -1 : 1;
      }
      return b.priority - a.priority;
    });
    return sorted[0];
  }, [myAssignments]);

  const todayTotal = React.useMemo(() => {
    return myAssignments.reduce((sum, a) => {
      const s = data.strategies.find((x) => x.id === a.strategyId);
      return sum + allocatedDailyTarget(a, s?.dailyTargetDefault);
    }, 0);
  }, [myAssignments, data.strategies]);

  const dayProgress = React.useMemo(
    () =>
      countUserDayProgress(
        ws.leads,
        ws.currentUserId,
        ws.intentPlaybook.outreachThreshold,
      ),
    [ws.leads, ws.currentUserId, ws.intentPlaybook.outreachThreshold],
  );

  const remaining = Math.max(0, todayTotal - dayProgress.researched);
  const pctComplete =
    todayTotal > 0 ? Math.min(100, Math.round((dayProgress.researched / todayTotal) * 100)) : 0;

  const startProspecting = (assignment?: StrategyAssignment, strategy?: ProspectingStrategy) => {
    quickAdd.openNewProspectForm({
      strategyId: strategy?.id ?? assignment?.strategyId,
      strategyAssignmentId: assignment?.id,
      strategyVersion: strategy?.version,
      personaId: (assignment?.personaIdsOverride ?? strategy?.personaIds)?.[0],
    });
  };

  if (data.loading) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2 py-12">
          <Loader2 className="size-4 animate-spin" /> Loading your strategy…
        </p>
      </PageBody>
    );
  }

  return (
    <>
      <PageHeader
        title="My Strategy"
        description="Today’s targets, personas, signals, and checklist for your assigned prospecting work."
        actions={
          myAssignments.length > 0 ? (
            <Button
              size="sm"
              type="button"
              onClick={() => {
                const s = data.strategies.find((x) => x.id === primary?.strategyId);
                startProspecting(primary, s);
              }}
            >
              <Play className="size-4" />
              Start prospecting
            </Button>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        {myAssignments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <p className="text-sm font-medium">No active strategy assignment</p>
              <p className="text-sm text-muted-foreground">
                Ask a manager to assign you a prospecting strategy from Configuration → Strategies.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Today’s target" value={String(todayTotal)} />
              <StatCard
                label="Completed"
                value={`${dayProgress.researched}`}
                hint={`${pctComplete}% of target`}
              />
              <StatCard label="Remaining" value={String(remaining)} />
              <StatCard
                label="Qualified / high-intent"
                value={`${dayProgress.qualified} / ${dayProgress.highIntent}`}
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Progress today</CardTitle>
                <CardDescription>
                  Primary:{" "}
                  {data.strategies.find((s) => s.id === primary?.strategyId)?.name ?? "—"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={pctComplete} className="h-2" />
              </CardContent>
            </Card>

            <div className="space-y-4">
              {myAssignments.map((assignment) => {
                const strategy = data.strategies.find((s) => s.id === assignment.strategyId);
                if (!strategy) return null;
                return (
                  <AssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    strategy={strategy}
                    personas={data.personas}
                    leads={ws.leads}
                    userId={ws.currentUserId}
                    outreachThreshold={ws.intentPlaybook.outreachThreshold}
                    playbookSignals={ws.intentPlaybook.signals}
                    onStart={() => startProspecting(assignment, strategy)}
                  />
                );
              })}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight mt-1">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground mt-0.5">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function AssignmentCard({
  assignment,
  strategy,
  personas,
  leads,
  userId,
  outreachThreshold,
  playbookSignals,
  onStart,
}: {
  assignment: StrategyAssignment;
  strategy: ProspectingStrategy;
  personas: BuyerPersona[];
  leads: ReturnType<typeof useWorkspace>["leads"];
  userId: string;
  outreachThreshold: number;
  playbookSignals: { id: string; label: string; points: number; category: string }[];
  onStart: () => void;
}) {
  const allocated = allocatedDailyTarget(assignment, strategy.dailyTargetDefault);
  const source = dailyTargetSource(assignment, strategy.dailyTargetDefault);
  const baseTarget = effectiveDailyTarget(assignment, strategy.dailyTargetDefault);
  const progress = countStrategyDayProgress({
    leads,
    userId,
    strategyId: strategy.id,
    outreachThreshold,
  });
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

  const signalDetails = strategy.linkedSignals
    .filter((l) => l.enabled)
    .map((l) => {
      const def = playbookSignals.find((s) => s.id === l.signalId);
      return { ...l, def };
    })
    .sort((a, b) => b.priority - a.priority);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base truncate">{strategy.name}</CardTitle>
            <Badge variant="outline">{assignment.assignmentType}</Badge>
            <Badge variant="secondary">{assignment.allocationPct}%</Badge>
          </div>
          <CardDescription>
            Daily target: {allocated} of {baseTarget} — {targetSourceLabel(source)}
          </CardDescription>
        </div>
        <Button size="sm" type="button" onClick={onStart}>
          <Play className="size-4" />
          Start
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-3 text-sm mb-4">
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="font-semibold">
              {progress.researched} / {allocated}
            </p>
          </div>
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">Qualified</p>
            <p className="font-semibold">{progress.qualified}</p>
          </div>
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">High intent</p>
            <p className="font-semibold">{progress.highIntent}</p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="personas">Personas</TabsTrigger>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
            <TabsTrigger value="process">Daily process</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-3 space-y-2 text-sm">
            <p>{strategy.description || strategy.objective || "No description."}</p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Industries: </span>
              {industries.length ? industries.join(", ") : "Any"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Countries: </span>
              {countries.length ? countries.join(", ") : "Any"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Company size: </span>
              {strategy.firmographics.companySizeMin
                ? COMPANY_SIZE_LABELS[strategy.firmographics.companySizeMin]
                : "Any"}
              {" – "}
              {strategy.firmographics.companySizeMax
                ? COMPANY_SIZE_LABELS[strategy.firmographics.companySizeMax]
                : "Any"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Outreach threshold: </span>
              {outreachThreshold}
            </p>
            {strategy.researchNotes ? (
              <p className="text-muted-foreground whitespace-pre-wrap">{strategy.researchNotes}</p>
            ) : null}
          </TabsContent>

          <TabsContent value="personas" className="mt-3 space-y-3">
            {linkedPersonas.length === 0 ? (
              <p className="text-sm text-muted-foreground">No personas linked.</p>
            ) : (
              linkedPersonas.map((p) => (
                <div key={p.id} className="rounded-md border px-3 py-2 text-sm space-y-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.titles
                      .filter((t) => t.kind === "approved")
                      .map((t) => t.title)
                      .join(" · ")}
                  </p>
                  {p.painPoints.length ? (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Pains: </span>
                      {p.painPoints.slice(0, 5).join("; ")}
                    </p>
                  ) : null}
                  {p.recommendedAngle ? (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Angle: </span>
                      {p.recommendedAngle}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="signals" className="mt-3 space-y-2">
            {signalDetails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No signals linked to this strategy.</p>
            ) : (
              signalDetails.map((s) => (
                <div key={s.signalId} className="rounded-md border px-3 py-2 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.def?.label ?? s.signalId}</span>
                    {s.required ? <Badge variant="outline">Required</Badge> : null}
                    {s.def ? (
                      <Badge variant="secondary">{s.def.points} pts</Badge>
                    ) : null}
                    {s.recencyDays != null ? (
                      <Badge variant="outline">≤ {s.recencyDays}d</Badge>
                    ) : null}
                  </div>
                  {s.instructions ? (
                    <p className="text-xs text-muted-foreground">{s.instructions}</p>
                  ) : null}
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="checklist" className="mt-3 space-y-1.5">
            {strategy.qualityChecklist
              .filter((c) => c.requirement !== "not_needed")
              .map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <CheckCircle2 className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
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
          </TabsContent>

          <TabsContent value="process" className="mt-3">
            {strategy.sopMarkdown ? (
              <pre className="whitespace-pre-wrap text-sm rounded-md border bg-muted/30 p-3 font-sans">
                {strategy.sopMarkdown}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No SOP written yet.</p>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Managers edit this in{" "}
              <Link href={`/admin/strategies/${strategy.id}`} className="underline">
                Strategies
              </Link>
              .
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
