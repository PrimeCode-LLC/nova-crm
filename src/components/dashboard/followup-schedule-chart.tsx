"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useChartSize } from "@/hooks/use-chart-size";
import { buildFollowupScheduleByDay } from "@/lib/dashboard-ops-analytics";
import { cn } from "@/lib/utils";
import type { Followup } from "@/lib/types";

export function FollowupScheduleChart({
  followups,
  compact,
}: {
  followups: Followup[];
  compact?: boolean;
}) {
  const data = React.useMemo(() => buildFollowupScheduleByDay({ followups }), [followups]);
  const { wrapRef, chartSize } = useChartSize({ w: 320, h: compact ? 160 : 200 });
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const totals = React.useMemo(
    () =>
      data.reduce(
        (a, d) => ({
          scheduled: a.scheduled + d.scheduled,
          overdue: a.overdue + d.overdue,
          completed: a.completed + d.completed,
        }),
        { scheduled: 0, overdue: 0, completed: 0 },
      ),
    [data],
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Follow-ups this month</CardTitle>
        <CardDescription className="text-xs">
          {monthLabel} · {totals.scheduled} upcoming · {totals.overdue} overdue · {totals.completed}{" "}
          done
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div ref={wrapRef} className={cn("w-full min-w-0", compact ? "h-40" : "h-52")}>
          {chartSize.w > 0 && chartSize.h > 0 ? (
            <BarChart
              width={chartSize.w}
              height={chartSize.h}
              data={data}
              margin={{ top: 6, right: 4, bottom: 0, left: -20 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval={compact ? 4 : 2}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="completed" name="Done" stackId="a" fill="var(--chart-3)" isAnimationActive={!compact} />
              <Bar dataKey="scheduled" name="Scheduled" stackId="a" fill="var(--chart-1)" isAnimationActive={!compact} />
              <Bar dataKey="overdue" name="Overdue" stackId="a" fill="var(--destructive)" isAnimationActive={!compact} />
            </BarChart>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-3)" }} /> Done
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-1)" }} /> Scheduled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-destructive" /> Overdue
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
