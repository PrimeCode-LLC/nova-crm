"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildActivityTrendSeries } from "@/lib/dashboard-analytics";
import type { ActivityRecord, Deal, Lead } from "@/lib/types";

export function TrendChart({
  leads: leadsOverride,
  deals: dealsOverride,
  activityRecords: activityRecordsOverride,
}: {
  leads?: Lead[];
  deals?: Deal[];
  activityRecords?: ActivityRecord[];
} = {}) {
  const ws = useWorkspace();
  const activityRecords = activityRecordsOverride ?? ws.activityRecords;
  const deals = dealsOverride ?? ws.deals;
  const leads = leadsOverride ?? ws.leads;
  const data = React.useMemo(
    () => buildActivityTrendSeries(activityRecords, deals, leads, 30),
    [activityRecords, deals, leads],
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">Activity trend</CardTitle>
            <CardDescription className="text-xs">
              New leads · replies · meetings · closed · last 30 days
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-56 w-full min-w-0 shrink-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            debounce={50}
            initialDimension={{ width: 320, height: 224 }}
          >
            <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gReplies" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gMeetings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gClosed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gNewLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
              />
              <Area
                type="monotone"
                dataKey="replies"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#gReplies)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="meetings"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#gMeetings)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="closed"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="url(#gClosed)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="newLeads"
                stroke="var(--chart-4)"
                strokeWidth={2}
                fill="url(#gNewLeads)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-4)" }} /> New leads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-1)" }} /> Replies
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-2)" }} /> Meetings
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-3)" }} /> Closed
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
