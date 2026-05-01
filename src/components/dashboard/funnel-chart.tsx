"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CHANNEL_FUNNELS } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { fmtNumber, fmtPercent } from "@/lib/format";

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
          return (
            <div key={s.key} className="group">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-muted-foreground">
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
              <Progress value={pctOfTop} className="h-1.5" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
