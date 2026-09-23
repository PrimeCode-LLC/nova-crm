"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { StrategyScoreboardSettings } from "@/components/dashboard/strategy-scoreboard-settings";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import {
  buildStrategyScoreboardRows,
  STRATEGY_SCOREBOARD_THIN_SAMPLE_MIN,
} from "@/lib/dashboard-strategy-scoreboard";
import { isStrategyScoreboardVisible } from "@/lib/dashboard-preferences";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { DASHBOARD_TIME_RANGE_LABELS } from "@/lib/dashboard-date-range";
import { fmtCurrency, fmtNumber, fmtPercent, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WallMetricTiles } from "@/components/dashboard/wall-metric-tiles";
import { useOpsScoreboards } from "@/hooks/use-ops-scoreboards";
import {
  inMemoryLeadScanUnavailable,
  SNAPSHOT_LEAD_SCAN_EMPTY_COPY,
} from "@/lib/dashboard-kpi-v2-flags";
import type { Deal, Followup, Lead } from "@/lib/types";

export function StrategyScoreboard({
  leads: leadsOverride,
  deals: dealsOverride,
  followups: followupsOverride,
  range = "30d",
  wall,
  className,
  orgWideScope: orgWideScopeProp,
}: {
  leads?: Lead[];
  deals?: Deal[];
  followups?: Followup[];
  range?: DashboardTimeRangeKey;
  wall?: boolean;
  className?: string;
  /** When true + flag, prefer Redis-backed scoreboard rows (P0.13). */
  orgWideScope?: boolean;
} = {}) {
  const ws = useWorkspace();
  const timeZone = useOrgTimezone();
  const { currentUserId, intentPlaybook } = ws;
  const leads = leadsOverride ?? ws.leads;
  const deals = dealsOverride ?? ws.deals;
  const followups = followupsOverride ?? ws.followups;
  const { strategies, assignments, loading } = useProspectingStrategyData();
  const {
    prefs,
    setStrategyScoreboardVisible,
    setAllStrategyScoreboardVisible,
  } = useDashboardPreferences(currentUserId || "anon");

  const orgWideScope =
    orgWideScopeProp ?? (!leadsOverride && !dealsOverride && !followupsOverride);
  const scoreboards = useOpsScoreboards({ range, orgWideScope });

  const leadScanOff =
    inMemoryLeadScanUnavailable(ws.isDemo, leads.length) &&
    !(scoreboards.enabled && scoreboards.payload?.strategy);

  const board = React.useMemo(() => {
    if (scoreboards.enabled && scoreboards.payload?.strategy) {
      return scoreboards.payload.strategy;
    }
    if (leadScanOff) {
      return {
        rows: [],
        attributionCoverage: 0,
        prospectsInRange: 0,
        attributedInRange: 0,
      };
    }
    return buildStrategyScoreboardRows({
      strategies,
      assignments,
      leads,
      deals,
      followups,
      range,
      outreachThreshold: intentPlaybook.outreachThreshold,
      timeZone,
    });
  }, [
    leadScanOff,
    scoreboards.enabled,
    scoreboards.payload,
    strategies,
    assignments,
    leads,
    deals,
    followups,
    range,
    intentPlaybook.outreachThreshold,
    timeZone,
  ]);

  const settingsOptions = React.useMemo(
    () =>
      board.rows.map((r) => ({
        id: r.strategyId,
        name: r.name,
        activeAssignees: r.activeAssignees,
      })),
    [board.rows],
  );

  const visibleRows = React.useMemo(
    () =>
      board.rows.filter((r) =>
        isStrategyScoreboardVisible(prefs.strategyScoreboardVisible, r.strategyId),
      ),
    [board.rows, prefs.strategyScoreboardVisible],
  );

  const rangeLabel = DASHBOARD_TIME_RANGE_LABELS[range];
  const allIds = settingsOptions.map((s) => s.id);

  return (
    <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
      <CardHeader className={cn("gap-2 pb-3", wall && "shrink-0")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
              Strategy scoreboard
            </CardTitle>
            <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
              Published strategies · quality & conversion · {rangeLabel}
            </CardDescription>
          </div>
          {!wall ? (
            <StrategyScoreboardSettings
              strategies={settingsOptions}
              visible={prefs.strategyScoreboardVisible}
              onChange={setStrategyScoreboardVisible}
              onShowAll={() => setAllStrategyScoreboardVisible(allIds, true)}
              onHideAll={() => setAllStrategyScoreboardVisible(allIds, false)}
            />
          ) : null}
        </div>
        {!wall && board.prospectsInRange > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Attribution coverage{" "}
            <span className="font-medium text-foreground">
              {fmtPercent(board.attributionCoverage, 0)}
            </span>{" "}
            ({fmtNumber(board.attributedInRange)} of {fmtNumber(board.prospectsInRange)} prospects
            tagged with a strategy)
          </p>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn(
          "pt-0",
          wall && "flex min-h-0 flex-1 flex-col overflow-hidden",
        )}
      >
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading strategies…</p>
        ) : leadScanOff ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {SNAPSHOT_LEAD_SCAN_EMPTY_COPY}
          </p>
        ) : board.rows.length === 0 ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              No published strategies yet. Draft, paused, and archived stay off this board.
            </p>
            {!wall ? (
              <Link
                href="/admin/strategies"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Manage strategies
              </Link>
            ) : null}
          </div>
        ) : visibleRows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            All published strategies are hidden. Use the settings control to turn some back on.
          </p>
        ) : wall ? (
          <ul className="flex min-h-0 flex-1 flex-col divide-y divide-border/50 overflow-y-auto">
            {visibleRows.slice(0, 4).map((r, i) => (
              <li key={r.strategyId} className="shrink-0 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm font-medium tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm">{r.name}</span>
                      {r.activeAssignees > 0 ? (
                        <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                          {r.activeAssignees} active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">
                          Unassigned
                        </Badge>
                      )}
                      {r.thinSample ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] font-normal text-muted-foreground"
                        >
                          &lt;{STRATEGY_SCOREBOARD_THIN_SAMPLE_MIN}
                        </Badge>
                      ) : null}
                      <StrategyAssigneeAvatars userIds={r.assigneeUserIds} />
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${Math.max(
                            2,
                            Math.min(
                              100,
                              visibleRows[0]?.score
                                ? Math.round((r.score / Math.max(1, visibleRows[0].score)) * 100)
                                : 0,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <WallMetricTiles
                  className={cn("mt-2.5 pl-8", r.thinSample && "opacity-70")}
                  columns={6}
                  items={[
                    { label: "Prospects", value: fmtNumber(r.prospects) },
                    { label: "Qualified %", value: fmtPercent(r.qualifiedRate) },
                    { label: "Leads", value: fmtNumber(r.salesLeads) },
                    { label: "Replies", value: fmtNumber(r.replies) },
                    { label: "Pipeline", value: fmtCurrency(r.openPipeline) },
                    { label: "Won", value: fmtCurrency(r.closedValue) },
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y">
            {visibleRows.map((r, i) => (
              <li key={r.strategyId} className="py-2.5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-4 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      {r.activeAssignees > 0 ? (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {r.activeAssignees} active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          Unassigned
                        </Badge>
                      )}
                      {r.thinSample ? (
                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                          &lt;{STRATEGY_SCOREBOARD_THIN_SAMPLE_MIN} sample
                        </Badge>
                      ) : null}
                      <StrategyAssigneeAvatars userIds={r.assigneeUserIds} />
                    </div>

                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${Math.max(
                            2,
                            Math.min(
                              100,
                              visibleRows[0]?.score
                                ? Math.round((r.score / Math.max(1, visibleRows[0].score)) * 100)
                                : 0,
                            ),
                          )}%`,
                        }}
                      />
                    </div>

                    <div
                      className={cn(
                        "mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs",
                        r.thinSample && "opacity-70",
                      )}
                    >
                      <Metric label="Prospects" value={fmtNumber(r.prospects)} />
                      <Metric
                        label="Avg quality"
                        value={r.avgQuality == null ? "-" : String(Math.round(r.avgQuality))}
                      />
                      <Metric label="Qualified" value={fmtPercent(r.qualifiedRate)} />
                      <Metric label="Leads" value={fmtNumber(r.salesLeads)} tone="success" />
                      <Metric label="Replies" value={fmtNumber(r.replies)} />
                      <Metric label="Reply rate" value={fmtPercent(r.replyRate)} tone="muted" />
                      <Metric label="Pipeline" value={fmtCurrency(r.openPipeline)} tone="muted" />
                      <Metric label="Won" value={fmtCurrency(r.closedValue)} tone="success" />
                    </div>

                    {r.prospects === 0 && r.activeAssignees > 0 ? (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-500">
                        <TriangleAlert className="h-3 w-3 shrink-0" />
                        <span>Assigned but no attributed prospects in this range</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StrategyAssigneeAvatars({
  userIds,
  max = 3,
}: {
  userIds: readonly string[];
  max?: number;
}) {
  const { getUserById, getOwnerDisplayName } = useWorkspace();
  if (userIds.length === 0) return null;

  const shown = userIds.slice(0, max);
  const extra = userIds.length - shown.length;

  return (
    <AvatarGroup className="shrink-0 -space-x-1.5">
      {shown.map((uid) => {
        const name =
          getUserById(uid)?.displayName?.trim() || getOwnerDisplayName(uid)?.trim() || "?";
        return (
          <Avatar
            key={uid}
            size="sm"
            className="size-5 after:border-border/80"
            title={name === "?" ? uid : name}
          >
            <AvatarFallback className="bg-primary/15 text-[9px] font-semibold text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {extra > 0 ? (
        <AvatarGroupCount className="size-5 text-[9px] font-medium">+{extra}</AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "success";
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          tone === "muted" && "text-muted-foreground",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </span>
    </span>
  );
}
