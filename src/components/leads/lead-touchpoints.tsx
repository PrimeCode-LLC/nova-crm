import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Touchpoint } from "@/lib/types";
import { CHANNELS } from "@/lib/constants";
import { ChannelChip } from "@/components/common/channel-chip";
import { fmtRelative, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function LeadTouchpoints({ touchpoints }: { touchpoints: Touchpoint[] }) {
  const byChannel = touchpoints.reduce<Record<string, Touchpoint[]>>((acc, t) => {
    (acc[t.channel] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Per-channel engagement state. A lead can be active on multiple channels at once.
        </p>
        <Button size="sm" variant="outline">
          <Plus className="h-3.5 w-3.5" /> Add touchpoint
        </Button>
      </div>

      {Object.entries(byChannel).map(([channel, items]) => (
        <Card key={channel}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ChannelChip channel={channel as keyof typeof CHANNELS} />
              {CHANNELS[channel as keyof typeof CHANNELS].label}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {items
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/20"
                  >
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {t.state}
                    </Badge>
                    <span className="text-sm flex-1">{t.summary ?? "-"}</span>
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      title={fmtDate(t.occurredAt, "PPpp")}
                    >
                      {fmtRelative(t.occurredAt)}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {touchpoints.length === 0 && (
        <div className="rounded-md border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No touchpoints yet. Add one as you engage this lead.
        </div>
      )}
    </div>
  );
}
