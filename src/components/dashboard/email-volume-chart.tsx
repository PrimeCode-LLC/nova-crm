"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChartSize } from "@/hooks/use-chart-size";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import {
  buildEmailVolumeSeries,
  emailVolumeTotals,
  type EmailVolumePeriod,
} from "@/lib/dashboard-ops-analytics";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Contact, Followup, Lead, LeadTask, TimelineEvent } from "@/lib/types";

const PERIODS: { key: EmailVolumePeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function EmailVolumeChart({
  followups,
  leads,
  contacts,
  tasks,
  timelineByLead,
  compact,
  fill,
  timeZone: timeZoneProp,
}: {
  followups: Followup[];
  leads: Lead[];
  contacts?: Contact[];
  tasks?: LeadTask[];
  timelineByLead?: Record<string, TimelineEvent[]>;
  compact?: boolean;
  /** Grow to fill the parent's height instead of a fixed chart height. */
  fill?: boolean;
  timeZone?: string;
}) {
  const orgTimeZone = useOrgTimezone();
  const timeZone = timeZoneProp ?? orgTimeZone;
  const [period, setPeriod] = React.useState<EmailVolumePeriod>("week");
  const data = React.useMemo(
    () =>
      buildEmailVolumeSeries({
        followups,
        leads,
        period,
        contacts,
        tasks,
        timelineByLead,
        timeZone,
      }),
    [followups, leads, period, contacts, tasks, timelineByLead, timeZone],
  );
  const totals = React.useMemo(() => emailVolumeTotals(data), [data]);
  const { wrapRef, chartSize } = useChartSize({ w: 320, h: compact ? 140 : 200 });

  return (
    <Card className={cn("min-w-0", fill && "flex h-full min-h-0 flex-col")}>
      <CardHeader className={cn("pb-2", fill && "shrink-0")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">Email volume</CardTitle>
            <CardDescription className="text-xs">
              Sent · opens · replies · bounces · {fmtNumber(totals.sent)} sent ·{" "}
              {fmtNumber(totals.opens)} opened · {fmtNumber(totals.replies)} replies ·{" "}
              {fmtNumber(totals.bounces)} bounced
            </CardDescription>
          </div>
          {!compact ? (
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
          ) : null}
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "pt-0",
          fill && "flex min-h-0 flex-1 flex-col overflow-hidden pb-1",
        )}
      >
        <div
          ref={wrapRef}
          className={cn(
            "w-full min-w-0",
            fill ? "min-h-0 flex-1" : compact ? "h-36" : "h-52",
          )}
        >
          {chartSize.w > 0 && chartSize.h > 0 ? (
            <AreaChart
              width={chartSize.w}
              height={chartSize.h}
              data={data}
              margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="opsSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="opsOpens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="opsReplies" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="opsBounces" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
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
                width={36}
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
                dataKey="opens"
                name="Opens"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="url(#opsOpens)"
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
              <Area
                type="monotone"
                dataKey="bounces"
                name="Bounces"
                stroke="var(--destructive)"
                strokeWidth={2}
                fill="url(#opsBounces)"
                isAnimationActive={!compact}
              />
            </AreaChart>
          ) : null}
        </div>
        <div className="mt-2 flex shrink-0 flex-wrap gap-x-4 gap-y-1 pb-0.5 text-[11px] leading-none text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: "var(--chart-1)" }} />{" "}
            Sent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: "var(--chart-3)" }} />{" "}
            Opens
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: "var(--chart-2)" }} />{" "}
            Replies
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-destructive" /> Bounces
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
