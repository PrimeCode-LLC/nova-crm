"use client";

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

function generateSeries(seed: number, days = 30) {
  const arr: { day: string; replies: number; meetings: number; closed: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const base = 8 + Math.sin((i + seed) * 0.6) * 4 + (seed % 3);
    arr.push({
      day: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      replies: Math.max(0, Math.round(base + 6)),
      meetings: Math.max(0, Math.round(base * 0.35 + 1)),
      closed: Math.max(0, Math.round(base * 0.1)),
    });
  }
  return arr;
}

export function TrendChart() {
  const data = generateSeries(4);
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">Activity trend</CardTitle>
            <CardDescription className="text-xs">
              Replies · meetings · closed · last 30 days
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
              />
              <Area
                type="monotone"
                dataKey="meetings"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#gMeetings)"
              />
              <Area
                type="monotone"
                dataKey="closed"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="url(#gClosed)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
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
