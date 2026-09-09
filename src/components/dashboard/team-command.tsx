"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, CircleCheck, Minus, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import {
  TEAM_COMMAND_LENSES,
  buildTeamCommandRows,
  type TeamCommandLens,
  type TeamCommandRow,
} from "@/lib/dashboard-team-command";
import {
  DASHBOARD_TIME_RANGE_LABELS,
  TEAM_COMMAND_TIME_RANGES,
  TEAM_COMMAND_TIME_RANGE_SHORT_LABELS,
  type DashboardTimeRangeKey,
  type TeamCommandTimeRangeKey,
} from "@/lib/dashboard-date-range";
import { useOpsScoreboards } from "@/hooks/use-ops-scoreboards";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import { WallMetricTiles } from "@/components/dashboard/wall-metric-tiles";
import type { Deal, Followup, Lead, LeadTask } from "@/lib/types";

const LENS_META: Record<TeamCommandLens, { label: string; blurb: string }> = {
  overall: { label: "Overall", blurb: "Relative activity across prospecting, outreach, follow-ups & closing" },
  leadgen: { label: "Prospecting", blurb: "Prospect quality & conversion to sales leads" },
  outreach: { label: "Outreach", blurb: "Emails sent & replies earned" },
  followups: { label: "Follow-ups", blurb: "Sequence steps completed & kept moving" },
  closing: { label: "Closing", blurb: "New pipeline added & revenue won" },
};

type Metric = { label: string; value: string; tone?: "default" | "muted" | "success" | "warn" };

function lensMetrics(lens: TeamCommandLens, row: TeamCommandRow): Metric[] {
  switch (lens) {
    case "leadgen":
      return [
        { label: "Prospects", value: fmtNumber(row.prospectsAdded) },
        { label: "Avg quality", value: row.avgQuality == null ? "-" : String(Math.round(row.avgQuality)) },
        {
          label: "Qualified",
          value: row.prospectsAdded > 0 ? fmtPercent((row.qualifiedProspects / row.prospectsAdded) * 100) : "-",
        },
        { label: "Leads", value: fmtNumber(row.salesLeadsAdded), tone: "success" },
      ];
    case "outreach":
      return [
        { label: "Sent", value: fmtNumber(row.emailsSent) },
        { label: "Replies", value: fmtNumber(row.replies), tone: "success" },
        { label: "Reply rate", value: fmtPercent(row.replyRate), tone: "muted" },
        ...(row.failed > 0
          ? [{ label: "Failed", value: fmtNumber(row.failed) }]
          : []),
      ];
    case "followups":
      return [
        { label: "Completed", value: fmtNumber(row.followupsCompleted) },
        { label: "Scheduled", value: fmtNumber(row.scheduled), tone: "muted" },
        ...(row.failed > 0
          ? [{ label: "Failed", value: fmtNumber(row.failed) }]
          : []),
      ];
    case "closing":
      return [
        { label: "Won", value: fmtNumber(row.wonCount) },
        { label: "Closed", value: fmtCurrency(row.closedValue), tone: "success" },
        { label: "Pipeline added", value: fmtCurrency(row.pipelineAdded), tone: "muted" },
      ];
    case "overall":
    default:
      return [
        { label: "Prospects", value: fmtNumber(row.prospectsAdded) },
        { label: "Leads", value: fmtNumber(row.salesLeadsAdded) },
        { label: "Sent", value: fmtNumber(row.emailsSent) },
        { label: "Replies", value: fmtNumber(row.replies) },
        { label: "Pipeline added", value: fmtCurrency(row.pipelineAdded), tone: "muted" },
        { label: "Won", value: fmtCurrency(row.closedValue), tone: "success" },
      ];
  }
}

type ScoreInsight = {
  helping: string;
  improve: string;
};

function quickScoreInsights(lens: TeamCommandLens, row: TeamCommandRow): ScoreInsight {
  if (lens === "overall") {
    const lenses = TEAM_COMMAND_LENSES.filter(
      (key): key is Exclude<TeamCommandLens, "overall"> => key !== "overall",
    );
    const ranked = [...lenses].sort((a, b) => row.scores[b] - row.scores[a]);
    const strongest = ranked[0];
    const weakest = ranked.at(-1) ?? ranked[0];
    const outcomeGap =
      row.emailsSent > 0 && row.replies === 0
        ? `0 replies from ${fmtNumber(row.emailsSent)} sent is limiting outcomes`
        : row.prospectsAdded > 0 && row.salesLeadsAdded === 0
          ? `0 lead conversions from ${fmtNumber(row.prospectsAdded)} prospects`
          : row.pipelineAdded > 0 && row.closedValue === 0
            ? "Convert new pipeline into won revenue"
            : row.closedValue === 0
              ? "No won revenue in this period"
              : `${LENS_META[weakest].label} is the weakest relative area (${row.scores[weakest]}/100)`;
    return {
      helping: `${LENS_META[strongest].label} is their strongest relative area (${row.scores[strongest]}/100)`,
      improve: outcomeGap,
    };
  }

  if (lens === "leadgen") {
    return {
      helping:
        row.salesLeadsAdded > 0
          ? `${fmtNumber(row.salesLeadsAdded)} converted lead${row.salesLeadsAdded === 1 ? "" : "s"} add 3× weight`
          : row.qualifiedProspects > 0
            ? `${fmtNumber(row.qualifiedProspects)} qualified prospect${row.qualifiedProspects === 1 ? "" : "s"} add 2× weight`
            : `${fmtNumber(row.prospectsAdded)} prospect${row.prospectsAdded === 1 ? "" : "s"} sourced`,
      improve:
        row.salesLeadsAdded === 0
          ? "Convert qualified prospects into sales leads"
          : "Increase qualified prospect volume",
    };
  }

  if (lens === "outreach") {
    return {
      helping:
        row.replies > 0
          ? `${fmtNumber(row.replies)} repl${row.replies === 1 ? "y" : "ies"} add 4× weight`
          : `${fmtNumber(row.emailsSent)} email${row.emailsSent === 1 ? "" : "s"} sent add volume`,
      improve:
        row.replies === 0
          ? "Earn replies - each reply counts 4×"
          : "Scale sent volume while protecting reply rate",
    };
  }

  if (lens === "followups") {
    return {
      helping: `${fmtNumber(row.followupsCompleted)} follow-up${row.followupsCompleted === 1 ? "" : "s"} completed`,
      improve:
        row.scheduled > 0
          ? `Complete ${fmtNumber(row.scheduled)} scheduled follow-up${row.scheduled === 1 ? "" : "s"}`
          : "Complete more follow-ups in this period",
    };
  }

  return {
    helping:
      row.closedValue > 0
        ? `${fmtCurrency(row.closedValue)} won is lifting closing`
        : row.pipelineAdded > 0
          ? `${fmtCurrency(row.pipelineAdded)} new pipeline is contributing`
          : "No positive closing driver yet",
    improve:
      row.pipelineAdded > 0
        ? "Convert new pipeline into won revenue"
        : "Add qualified pipeline and close deals",
  };
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <Minus className="h-3 w-3" /> 0
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums",
        up ? "text-success" : "text-destructive",
      )}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(delta)}
    </span>
  );
}

function toTeamCommandRange(range: DashboardTimeRangeKey): TeamCommandTimeRangeKey {
  if ((TEAM_COMMAND_TIME_RANGES as readonly string[]).includes(range)) {
    return range as TeamCommandTimeRangeKey;
  }
  return "30d";
}

export function TeamCommand({
  leads: leadsOverride,
  deals: dealsOverride,
  followups: followupsOverride,
  tasks: tasksOverride,
  range = "30d",
  wall,
  className,
  orgWideScope: orgWideScopeProp,
}: {
  leads?: Lead[];
  deals?: Deal[];
  followups?: Followup[];
  tasks?: LeadTask[];
  range?: DashboardTimeRangeKey;
  wall?: boolean;
  className?: string;
  /** When true + flag, prefer Redis-backed scoreboard rows (P0.13). */
  orgWideScope?: boolean;
} = {}) {
  const ws = useWorkspace();
  const timeZone = useOrgTimezone();
  const { users, currentUserId, leadTasks, followups: wsFollowups, intentPlaybook } = ws;
  // Prefer overrides (channel/owner-scoped, not date-capped) when the parent
  // supplies them; fall back to full workspace for standalone / wall usage.
  const leads = leadsOverride ?? ws.leads;
  const deals = dealsOverride ?? ws.deals;
  const followups = followupsOverride ?? wsFollowups;
  const tasks = tasksOverride ?? leadTasks;
  const [lens, setLens] = React.useState<TeamCommandLens>("overall");
  const [localRange, setLocalRange] = React.useState<TeamCommandTimeRangeKey>(() =>
    toTeamCommandRange(range),
  );

  React.useEffect(() => {
    setLocalRange(toTeamCommandRange(range));
  }, [range]);

  const orgWideScope =
    orgWideScopeProp ??
    (!leadsOverride && !dealsOverride && !followupsOverride && !tasksOverride);
  const scoreboards = useOpsScoreboards({
    range: localRange,
    orgWideScope,
  });

  const viewer = users.find((u) => u.id === currentUserId);
  const canSeeTeam =
    viewer?.roleId === "director" ||
    viewer?.roleId === "manager" ||
    viewer?.roleId === "team_lead" ||
    viewerHasElevatedWorkspaceRole(viewer);

  const rowsAll = React.useMemo(() => {
    if (scoreboards.enabled && scoreboards.payload?.teamCommand) {
      return scoreboards.payload.teamCommand;
    }
    return buildTeamCommandRows({
      users,
      leads,
      deals,
      followups,
      tasks,
      range: localRange,
      outreachThreshold: intentPlaybook.outreachThreshold,
      timeZone,
    });
  }, [
    scoreboards.enabled,
    scoreboards.payload,
    users,
    leads,
    deals,
    followups,
    tasks,
    localRange,
    intentPlaybook.outreachThreshold,
    timeZone,
  ]);

  const scoped = canSeeTeam ? rowsAll : rowsAll.filter((r) => r.userId === currentUserId);
  const rows = React.useMemo(
    () => [...scoped].sort((a, b) => b.scores[lens] - a.scores[lens]),
    [scoped, lens],
  );

  const rangeLabel = DASHBOARD_TIME_RANGE_LABELS[localRange];
  const podium = rows.slice(0, 3);

  return (
    <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
      <CardHeader className={cn("gap-3 pb-3", wall && "shrink-0")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
              {canSeeTeam ? "Team command" : "Your performance"}
            </CardTitle>
            <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
              {LENS_META[lens].blurb} · Team-relative score · {rangeLabel}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Tabs
              value={localRange}
              onValueChange={(v) => setLocalRange(v as TeamCommandTimeRangeKey)}
            >
              <TabsList>
                {TEAM_COMMAND_TIME_RANGES.map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {TEAM_COMMAND_TIME_RANGE_SHORT_LABELS[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={lens} onValueChange={(v) => setLens(v as TeamCommandLens)}>
              <TabsList>
                {TEAM_COMMAND_LENSES.map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {LENS_META[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", wall && "min-h-0 flex-1 overflow-y-auto")}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No scored activity for non-director teammates in this range yet.
          </p>
        ) : (
          <div className="flex flex-col">
            {canSeeTeam && podium.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {podium.map((r, i) => (
                  <div
                    key={r.userId}
                    className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                        i === 0 && "bg-chart-1/25 text-foreground",
                        i === 1 && "bg-chart-2/25 text-foreground",
                        i === 2 && "bg-chart-3/25 text-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <UserChip userId={r.userId} size="xs" />
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                      {r.scores[lens]}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <ul className={cn("divide-y", wall && "divide-border/50")}>
              {rows.map((r, i) => {
                const metrics = lensMetrics(lens, r);
                const score = r.scores[lens];
                const insights = quickScoreInsights(lens, r);
                return (
                  <li key={r.userId} className={cn(wall ? "py-3.5" : "py-2.5")}>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "shrink-0 text-right font-medium tabular-nums text-muted-foreground",
                          wall ? "w-5 text-sm" : "w-4 text-xs",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <UserChip userId={r.userId} />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-baseline gap-1.5">
                          {wall ? (
                            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                              Relative activity
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              wall ? "text-lg" : "text-sm",
                            )}
                          >
                            {score}
                          </span>
                        </div>
                        {!wall ? (
                          <span className="text-[11px]">
                            <DeltaBadge delta={r.deltas[lens]} />
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className={cn("mt-1.5 flex items-center gap-3", wall ? "pl-8" : "pl-7")}>
                      <div
                        className={cn(
                          "flex-1 overflow-hidden rounded-full bg-muted",
                          wall ? "h-2" : "h-1.5",
                        )}
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
                        />
                      </div>
                    </div>

                    {wall ? (
                      <>
                        <WallMetricTiles
                          className="mt-2.5 pl-8"
                          items={metrics}
                          columns={metrics.length <= 4 ? 4 : 6}
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2 pl-8 text-[11px] leading-tight">
                          <p className="flex min-w-0 items-center gap-1.5 text-emerald-400">
                            <CircleCheck className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              <span className="font-medium">Helping:</span> {insights.helping}
                            </span>
                          </p>
                          <p className="flex min-w-0 items-center gap-1.5 text-amber-400">
                            <TriangleAlert className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              <span className="font-medium">Improve:</span> {insights.improve}
                            </span>
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 pl-7 text-xs">
                        {metrics.map((m) => (
                          <span key={m.label} className="inline-flex items-baseline gap-1">
                            <span className="text-muted-foreground">{m.label}</span>
                            <span
                              className={cn(
                                "font-medium tabular-nums",
                                m.tone === "muted" && "text-muted-foreground",
                                m.tone === "success" && "text-success",
                              )}
                            >
                              {m.value}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {r.bottleneck ? (
                      <div
                        className={cn(
                          "mt-1.5 flex items-center gap-1.5 text-amber-500",
                          wall ? "pl-8 text-xs" : "pl-7 text-[11px]",
                        )}
                      >
                        <TriangleAlert className="h-3 w-3 shrink-0" />
                        <span>{r.bottleneck}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
