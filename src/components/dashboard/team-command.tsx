"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Minus, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import type { Deal, Followup, Lead, LeadTask } from "@/lib/types";

const LENS_META: Record<TeamCommandLens, { label: string; blurb: string }> = {
  overall: { label: "Overall", blurb: "Blended score across prospecting, outreach, follow-ups & closing" },
  leadgen: { label: "Lead-gen", blurb: "Prospect quality & conversion to sales leads" },
  outreach: { label: "Outreach", blurb: "Emails sent & replies earned" },
  followups: { label: "Follow-ups", blurb: "Sequence steps completed & kept moving" },
  closing: { label: "Closing", blurb: "Pipeline built & revenue won" },
};

type Metric = { label: string; value: string; tone?: "default" | "muted" | "success" };

function lensMetrics(lens: TeamCommandLens, row: TeamCommandRow): Metric[] {
  switch (lens) {
    case "leadgen":
      return [
        { label: "Prospects", value: fmtNumber(row.prospectsAdded) },
        { label: "Avg quality", value: row.avgQuality == null ? "—" : String(Math.round(row.avgQuality)) },
        {
          label: "Qualified",
          value: row.prospectsAdded > 0 ? fmtPercent((row.qualifiedProspects / row.prospectsAdded) * 100) : "—",
        },
        { label: "Leads", value: fmtNumber(row.salesLeadsAdded), tone: "success" },
      ];
    case "outreach":
      return [
        { label: "Sent", value: fmtNumber(row.emailsSent) },
        { label: "Replies", value: fmtNumber(row.replies), tone: "success" },
        { label: "Reply rate", value: fmtPercent(row.replyRate), tone: "muted" },
      ];
    case "followups":
      return [
        { label: "Completed", value: fmtNumber(row.followupsCompleted) },
        { label: "Scheduled", value: fmtNumber(row.scheduled), tone: "muted" },
      ];
    case "closing":
      return [
        { label: "Won", value: fmtNumber(row.wonCount) },
        { label: "Closed", value: fmtCurrency(row.closedValue), tone: "success" },
        { label: "Pipeline", value: fmtCurrency(row.openPipeline), tone: "muted" },
      ];
    case "overall":
    default:
      return [
        { label: "Prospects", value: fmtNumber(row.prospectsAdded) },
        { label: "Leads", value: fmtNumber(row.salesLeadsAdded) },
        { label: "Sent", value: fmtNumber(row.emailsSent) },
        { label: "Replies", value: fmtNumber(row.replies) },
        { label: "Pipeline", value: fmtCurrency(row.openPipeline), tone: "muted" },
        { label: "Won", value: fmtCurrency(row.closedValue), tone: "success" },
      ];
  }
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
}: {
  leads?: Lead[];
  deals?: Deal[];
  followups?: Followup[];
  tasks?: LeadTask[];
  range?: DashboardTimeRangeKey;
  wall?: boolean;
} = {}) {
  const ws = useWorkspace();
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

  const viewer = users.find((u) => u.id === currentUserId);
  const canSeeTeam =
    viewer?.roleId === "director" ||
    viewer?.roleId === "manager" ||
    viewer?.roleId === "team_lead" ||
    viewerHasElevatedWorkspaceRole(viewer);

  const rowsAll = React.useMemo(
    () =>
      buildTeamCommandRows({
        users,
        leads,
        deals,
        followups,
        tasks,
        range: localRange,
        outreachThreshold: intentPlaybook.outreachThreshold,
      }),
    [users, leads, deals, followups, tasks, localRange, intentPlaybook.outreachThreshold],
  );

  const scoped = canSeeTeam ? rowsAll : rowsAll.filter((r) => r.userId === currentUserId);
  const rows = React.useMemo(
    () => [...scoped].sort((a, b) => b.scores[lens] - a.scores[lens]),
    [scoped, lens],
  );

  const rangeLabel = DASHBOARD_TIME_RANGE_LABELS[localRange];
  const podium = rows.slice(0, 3);

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
              {canSeeTeam ? "Team command" : "Your performance"}
            </CardTitle>
            <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
              {LENS_META[lens].blurb} · {rangeLabel}
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
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No scored activity in this range yet.
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

            <ul className="divide-y">
              {rows.map((r, i) => {
                const metrics = lensMetrics(lens, r);
                const score = r.scores[lens];
                return (
                  <li key={r.userId} className="py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-4 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <UserChip userId={r.userId} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">{score}</span>
                        {!wall ? (
                          <span className="text-[11px]">
                            <DeltaBadge delta={r.deltas[lens]} />
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center gap-3 pl-7">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
                        />
                      </div>
                    </div>

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

                    {r.bottleneck ? (
                      <div className="mt-1.5 flex items-center gap-1.5 pl-7 text-[11px] text-amber-500">
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
