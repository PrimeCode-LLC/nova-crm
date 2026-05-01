"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtRelative } from "@/lib/format";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";

export function IdleLeads() {
  const { leads } = useWorkspace();
  const rows = [...leads]
    .filter((l) => l.isIdle)
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Idle leads
            </CardTitle>
            <CardDescription className="text-xs">
              {rows.length} leads with no activity over threshold
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            nativeButton={false}
            render={
              <Link href="/leads?filter=idle">
                See all <ChevronRight className="h-3 w-3 ml-1" />
              </Link>
            }
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0 divide-y">
        {rows.map((l) => (
          <Link
            key={l.id}
            href={`/leads/${l.id}`}
            className="flex items-center gap-3 py-2.5 -mx-1 px-1 rounded hover:bg-muted/40 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{l.contactName}</span>
                <ChannelChip channel={l.channel} compact />
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {l.companyName} · {l.companyIndustry}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <StageBadge stage={l.stage} />
              <Badge
                variant="outline"
                className="bg-rose-500/10 text-rose-400 border-rose-500/20 tabular-nums"
              >
                {l.idleDays}d idle
              </Badge>
              <div className="hidden md:block w-32">
                <UserChip userId={l.ownerId} size="xs" />
              </div>
              <span className="hidden lg:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {fmtRelative(l.lastActivityAt)}
              </span>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
