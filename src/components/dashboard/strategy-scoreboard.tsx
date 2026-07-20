"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StrategyScoreboardSettings } from "@/components/dashboard/strategy-scoreboard-settings";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import {
  buildStrategyScoreboardRows,
  STRATEGY_SCOREBOARD_THIN_SAMPLE_MIN,
} from "@/lib/dashboard-strategy-scoreboard";
import { isStrategyScoreboardVisible } from "@/lib/dashboard-preferences";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { DASHBOARD_TIME_RANGE_LABELS } from "@/lib/dashboard-date-range";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Deal, Followup, Lead } from "@/lib/types";

export function StrategyScoreboard({
  leads: leadsOverride,
  deals: dealsOverride,
  followups: followupsOverride,
  range = "30d",
  wall,
}: {
  leads?: Lead[];
  deals?: Deal[];
  followups?: Followup[];
  range?: DashboardTimeRangeKey;
  wall?: boolean;
} = {}) {
  const ws = useWorkspace();
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

  const board = React.useMemo(
    () =>
      buildStrategyScoreboardRows({
        strategies,
        assignments,
        leads,
        deals,
        followups,
        range,
        outreachThreshold: intentPlaybook.outreachThreshold,
      }),
    [strategies, assignments, leads, deals, followups, range, intentPlaybook.outreachThreshold],
  );

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
    <Card className="min-w-0">
      <CardHeader className="gap-2 pb-3">
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
      <CardContent className="pt-0">
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading strategies…</p>
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
                        value={r.avgQuality == null ? "—" : String(Math.round(r.avgQuality))}
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
