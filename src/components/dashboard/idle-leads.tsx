"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { useCrmEntityPages } from "@/hooks/use-crm-entity-pages";
import { fmtRelative } from "@/lib/format";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import type { Lead } from "@/lib/types";
import { IDLE_LEAD_THRESHOLD_DAYS } from "@/lib/lead-idle";

export function IdleLeads({ leads: leadsOverride }: { leads?: Lead[] } = {}) {
  const ws = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(ws.isDemo);
  const idlePages = useCrmEntityPages({
    entity: "leads",
    enabled: snapshotOff,
    limit: 6,
    filters: { isIdle: true, activeOnly: true, intakeKind: "sales_lead" },
  });
  const leads = snapshotOff ? (idlePages.items as Lead[]) : (leadsOverride ?? ws.leads);
  const idleLeads = React.useMemo(
    () =>
      [...leads]
        .filter((l) => l.isIdle)
        .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0)),
    [leads],
  );
  const rows = idleLeads.slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Idle leads
            </CardTitle>
            <CardDescription className="text-xs">
              {idleLeads.length} {idleLeads.length === 1 ? "lead" : "leads"} with no activity in{" "}
              {IDLE_LEAD_THRESHOLD_DAYS}+ days (open pipeline)
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
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">No idle leads in this view.</p>
        )}
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
                className="bg-destructive/10 text-destructive border-destructive/20 tabular-nums"
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
