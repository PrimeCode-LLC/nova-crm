"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CHANNEL_FUNNELS } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { buildFunnelDrillHref } from "@/lib/leads-drill-down";
import { cn } from "@/lib/utils";

interface FunnelChartProps {
  channel: ChannelKey;
  title: string;
  counts: Record<string, number>;
}

export function FunnelChart({ channel, title, counts }: FunnelChartProps) {
  const stages = CHANNEL_FUNNELS[channel];
  const top = counts[stages[0].key] ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <CardDescription className="text-xs">
              {fmtNumber(top)} entries at the top of funnel
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2.5">
        {stages.map((s, i) => {
          const val = counts[s.key] ?? 0;
          const prev = i === 0 ? val : counts[stages[i - 1].key] ?? 0;
          const pctOfTop = top > 0 ? (val / top) * 100 : 0;
          const convFromPrev = prev > 0 ? (val / prev) * 100 : 0;
          const href = buildFunnelDrillHref(channel, s.key);
          return (
            <Link
              key={s.key}
              href={href}
              className={cn(
                "group block rounded-md -mx-1 px-1 py-0.5 transition-colors",
                "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-muted-foreground group-hover:text-foreground">
                  {s.label}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-foreground">{fmtNumber(val)}</span>
                  {i > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {fmtPercent(convFromPrev, 1)}
                    </span>
                  )}
                </span>
              </div>
              <Progress value={pctOfTop} className="h-1.5 pointer-events-none" />
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
