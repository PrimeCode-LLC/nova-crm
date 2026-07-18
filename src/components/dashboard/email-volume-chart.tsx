"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChartSize } from "@/hooks/use-chart-size";
import {
  buildEmailVolumeSeries,
  emailVolumeTotals,
  type EmailVolumePeriod,
} from "@/lib/dashboard-ops-analytics";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Followup, Lead } from "@/lib/types";

const PERIODS: { key: EmailVolumePeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function EmailVolumeChart({
  followups,
  leads,
  compact,
}: {
  followups: Followup[];
  leads: Lead[];
  compact?: boolean;
}) {
  const [period, setPeriod] = React.useState<EmailVolumePeriod>("week");
  const data = React.useMemo(
    () => buildEmailVolumeSeries({ followups, leads, period }),
    [followups, leads, period],
  );
  const totals = React.useMemo(() => emailVolumeTotals(data), [data]);
  const { wrapRef, chartSize } = useChartSize({ w: 320, h: compact ? 160 : 200 });

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">Email volume</CardTitle>
            <CardDescription className="text-xs">
              Sent vs replies · {fmtNumber(totals.sent)} sent · {fmtNumber(totals.replies)} replies
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={period === p.key ? "secondary" : "ghost"}
                className={cn("h-7 px-2 text-[11px]", period === p.key && "font-semibold")}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div ref={wrapRef} className={cn("w-full min-w-0", compact ? "h-40" : "h-52")}>
          {chartSize.w > 0 && chartSize.h > 0 ? (
            <AreaChart
              width={chartSize.w}
              height={chartSize.h}
              data={data}
              margin={{ top: 6, right: 8, bottom: 0, left: -16 }}
            >
              <defs>
                <linearGradient id="opsSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="opsReplies" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={period === "today" ? 16 : 12}
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
              <Area
                type="monotone"
                dataKey="sent"
                name="Sent"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#opsSent)"
                isAnimationActive={!compact}
              />
              <Area
                type="monotone"
                dataKey="replies"
                name="Replies"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#opsReplies)"
                isAnimationActive={!compact}
              />
            </AreaChart>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
