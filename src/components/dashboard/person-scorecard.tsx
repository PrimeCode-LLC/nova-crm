"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { buildOpsScorecardRows } from "@/lib/dashboard-ops-analytics";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { DASHBOARD_TIME_RANGE_LABELS } from "@/lib/dashboard-date-range";
import { ROLES, roleLabel } from "@/lib/constants";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import { useOpsScoreboards } from "@/hooks/use-ops-scoreboards";
import type { Deal, Followup, Lead, LeadTask } from "@/lib/types";

export function PersonScorecard({
  leads: leadsOverride,
  deals: dealsOverride,
  followups: followupsOverride,
  tasks: tasksOverride,
  range = "30d",
  wall,
  orgWideScope: orgWideScopeProp,
}: {
  leads?: Lead[];
  deals?: Deal[];
  followups?: Followup[];
  tasks?: LeadTask[];
  range?: DashboardTimeRangeKey;
  wall?: boolean;
  /** When true + flag, prefer Redis-backed scoreboard rows (P0.13). */
  orgWideScope?: boolean;
} = {}) {
  const ws = useWorkspace();
  const timeZone = useOrgTimezone();
  const { users, currentUserId, leadTasks, followups: wsFollowups } = ws;
  const leads = leadsOverride ?? ws.leads;
  const deals = dealsOverride ?? ws.deals;
  const followups = followupsOverride ?? wsFollowups;
  const tasks = tasksOverride ?? leadTasks;
  const viewer = users.find((u) => u.id === currentUserId);
  const canSeeTeam =
    viewer?.roleId === "director" ||
    viewer?.roleId === "manager" ||
    viewer?.roleId === "team_lead" ||
    viewerHasElevatedWorkspaceRole(viewer);

  const orgWideScope =
    orgWideScopeProp ??
    (!leadsOverride && !dealsOverride && !followupsOverride && !tasksOverride);
  const scoreboards = useOpsScoreboards({ range, orgWideScope });

  const rowsAll = React.useMemo(() => {
    if (scoreboards.enabled && scoreboards.payload?.opsScorecard) {
      return scoreboards.payload.opsScorecard;
    }
    return buildOpsScorecardRows({
      users,
      leads,
      deals,
      followups,
      tasks,
      range,
      timeZone,
    });
  }, [
    scoreboards.enabled,
    scoreboards.payload,
    users,
    leads,
    deals,
    followups,
    tasks,
    range,
    timeZone,
  ]);

  const rows = canSeeTeam ? rowsAll : rowsAll.filter((r) => r.userId === currentUserId);
  const rangeLabel = DASHBOARD_TIME_RANGE_LABELS[range];

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
          {canSeeTeam ? "Team scorecard" : "Your scorecard"}
        </CardTitle>
        <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
          Prospects, outreach & pipeline · {rangeLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No scored activity in this range yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8">Person</TableHead>
                {!wall && <TableHead className="h-8">Role</TableHead>}
                <TableHead className="h-8 text-right">Prospects</TableHead>
                <TableHead className="h-8 text-right">Leads</TableHead>
                <TableHead className="h-8 text-right">Sent</TableHead>
                <TableHead className="h-8 text-right">Replies</TableHead>
                {!wall && <TableHead className="h-8 text-right">Done</TableHead>}
                <TableHead className="h-8 text-right">Pipeline</TableHead>
                <TableHead className="h-8 text-right">Closed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const user = users.find((u) => u.id === r.userId);
                return (
                  <TableRow key={r.userId}>
                    <TableCell className="py-2">
                      <UserChip userId={r.userId} />
                    </TableCell>
                    {!wall && (
                      <TableCell className="py-2">
                        {user ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {roleLabel(user.roleId)}
                          </Badge>
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell className="py-2 text-right tabular-nums">
                      {fmtNumber(r.prospectsAdded)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums">
                      {fmtNumber(r.salesLeadsAdded)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums font-medium">
                      {fmtNumber(r.emailsSent)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{fmtNumber(r.replies)}</TableCell>
                    {!wall && (
                      <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                        {fmtNumber(r.followupsCompleted + r.tasksCompleted)}
                      </TableCell>
                    )}
                    <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                      {fmtCurrency(r.openPipeline)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums font-semibold text-success">
                      {fmtCurrency(r.closedValue)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
