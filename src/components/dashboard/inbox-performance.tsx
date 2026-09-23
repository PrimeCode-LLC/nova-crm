"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserChip } from "@/components/common/user-chip";
import { buildInboxPerformanceRows } from "@/lib/dashboard-ops-analytics";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { DASHBOARD_TIME_RANGE_LABELS } from "@/lib/dashboard-date-range";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { useOpsScoreboards } from "@/hooks/use-ops-scoreboards";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  inMemoryLeadScanUnavailable,
  SNAPSHOT_LEAD_SCAN_EMPTY_COPY,
} from "@/lib/dashboard-kpi-v2-flags";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Followup, Lead, User } from "@/lib/types";

export function InboxPerformance({
  users,
  leads,
  followups,
  range,
  wall,
  orgWideScope = false,
}: {
  users: User[];
  leads: Lead[];
  followups: Followup[];
  range: DashboardTimeRangeKey;
  wall?: boolean;
  /** When true + flag, prefer Redis-backed scoreboard rows (P0.13). */
  orgWideScope?: boolean;
}) {
  const timeZone = useOrgTimezone();
  const { isDemo } = useWorkspace();
  const scoreboards = useOpsScoreboards({ range, orgWideScope });
  const limit = wall ? 6 : 10;
  const leadScanOff =
    inMemoryLeadScanUnavailable(isDemo, leads.length) &&
    !(scoreboards.enabled && (scoreboards.payload?.inbox?.length ?? 0) > 0);
  const rows = React.useMemo(() => {
    if (scoreboards.enabled && (scoreboards.payload?.inbox?.length ?? 0) > 0) {
      return scoreboards.payload!.inbox.slice(0, limit);
    }
    if (leadScanOff) return [];
    return buildInboxPerformanceRows({
      users,
      leads,
      followups,
      range,
      timeZone,
      limit,
    });
  }, [
    leadScanOff,
    scoreboards.enabled,
    scoreboards.payload,
    users,
    leads,
    followups,
    range,
    wall,
    timeZone,
    limit,
  ]);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
          Top performers
        </CardTitle>
        <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
          Emails sent & replies by assigned owner · {DASHBOARD_TIME_RANGE_LABELS[range]}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {leadScanOff ? SNAPSHOT_LEAD_SCAN_EMPTY_COPY : "No outreach in this range yet."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8">Person</TableHead>
                <TableHead className="h-8 text-right">Sent</TableHead>
                <TableHead className="h-8 text-right">Replies</TableHead>
                <TableHead className="h-8 text-right">Rate</TableHead>
                {!wall && <TableHead className="h-8 text-right">Queued</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.userId}>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                          i === 0 && "bg-chart-1/20 text-foreground",
                          i === 1 && "bg-chart-2/20 text-foreground",
                          i === 2 && "bg-chart-3/20 text-foreground",
                          i > 2 && "bg-muted text-muted-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                      <UserChip userId={r.userId} />
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums font-medium">
                    {fmtNumber(r.emailsSent)}
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{fmtNumber(r.replies)}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                    {fmtPercent(r.replyRate, 0)}
                  </TableCell>
                  {!wall && (
                    <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                      {fmtNumber(r.scheduled)}
                      {r.failed > 0 ? (
                        <span className="ml-1 text-destructive">· {r.failed} fail</span>
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
