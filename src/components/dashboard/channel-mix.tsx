"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CHANNELS, CHANNEL_LIST } from "@/lib/constants";
import { mockLeads } from "@/lib/mock-data";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { ChannelChip } from "@/components/common/channel-chip";

export function ChannelMix() {
  const total = mockLeads.length;
  const rows = CHANNEL_LIST.map((c) => {
    const count = mockLeads.filter((l) => l.channel === c.key).length;
    const won = mockLeads.filter((l) => l.channel === c.key && l.stage === "won").length;
    return {
      key: c.key,
      count,
      won,
      pct: total > 0 ? (count / total) * 100 : 0,
      winRate: count > 0 ? (won / count) * 100 : 0,
    };
  }).sort((a, b) => b.count - a.count);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Channel mix</CardTitle>
        <CardDescription className="text-xs">Lead volume + win rate per channel</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="group">
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2">
                <ChannelChip channel={r.key} />
                <span className="text-muted-foreground">{CHANNELS[r.key].label}</span>
              </div>
              <span className="flex items-center gap-3 tabular-nums">
                <span className="text-muted-foreground">{fmtNumber(r.count)} leads</span>
                <span className="font-semibold text-emerald-400">
                  {fmtPercent(r.winRate, 1)} win
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${r.pct}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
