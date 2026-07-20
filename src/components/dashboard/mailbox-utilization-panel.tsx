"use client";

import * as React from "react";
import { Maximize2, Inbox } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/common/user-chip";
import { MailboxUtilizationDialog } from "@/components/dashboard/mailbox-utilization-dialog";
import { useMailboxUtilization } from "@/hooks/use-mailbox-utilization";
import {
  MAILBOX_UTILIZATION_STATUS_LABEL,
  pickNeedsAttentionRows,
  pickWellUtilizedRows,
  type MailboxUtilizationRow,
  type MailboxUtilizationStatus,
} from "@/lib/email/mailbox-utilization";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusTone(status: MailboxUtilizationStatus): string {
  switch (status) {
    case "hot":
      return "border-chart-1/30 bg-chart-1/10";
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10";
    case "underused":
      return "border-amber-500/30 bg-amber-500/10";
    case "idle":
    case "unassigned":
      return "border-destructive/30 bg-destructive/10";
    default:
      return "border-border bg-muted/30";
  }
}

function MiniRow({ row }: { row: MailboxUtilizationRow }) {
  const util = row.utilizationWeek ?? row.utilizationToday;
  return (
    <li
      className={cn(
        "rounded-md border px-2.5 py-2",
        statusTone(row.status),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.label}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {row.emailAddress || "No address"}
          </p>
        </div>
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] font-normal">
          {MAILBOX_UTILIZATION_STATUS_LABEL[row.status]}
        </Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span className="tabular-nums">
          Today {fmtNumber(row.sentToday)}
          {row.dailySendLimit != null ? ` / ${fmtNumber(row.dailySendLimit)}` : ""}
        </span>
        <span className="tabular-nums">Week {fmtNumber(row.sentWeek)}</span>
        {util != null ? (
          <span className="tabular-nums font-medium text-foreground">
            {fmtPercent(util, util % 1 === 0 ? 0 : 1)} util
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {row.assignedUserIds.length === 0 ? (
          <span className="text-[10px] text-destructive">Unassigned</span>
        ) : (
          row.assignedUserIds.slice(0, 3).map((uid) => (
            <UserChip key={uid} userId={uid} size="xs" />
          ))
        )}
        {row.assignedUserIds.length > 3 ? (
          <span className="text-[10px] text-muted-foreground">
            +{row.assignedUserIds.length - 3}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function Column({
  title,
  empty,
  children,
  wall,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
  wall?: boolean;
}) {
  const hasKids = React.Children.count(children) > 0;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-foreground">{title}</div>
      {hasKids ? (
        <ul className="space-y-1.5">{children}</ul>
      ) : (
        <p className={cn("text-muted-foreground", wall ? "text-sm" : "text-xs")}>{empty}</p>
      )}
    </div>
  );
}

export function MailboxUtilizationPanel({
  isDemo,
  currentUserId,
  wall,
  className,
}: {
  isDemo: boolean;
  currentUserId: string;
  wall?: boolean;
  className?: string;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const { rows, summary, loading, error } = useMailboxUtilization({
    enabled: true,
    isDemo,
    currentUserId,
  });

  const needs = React.useMemo(() => pickNeedsAttentionRows(rows, wall ? 6 : 3), [rows, wall]);
  const best = React.useMemo(() => pickWellUtilizedRows(rows, wall ? 6 : 3), [rows, wall]);

  return (
    <>
      <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
        <CardHeader className={cn("pb-2", wall && "shrink-0")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
                Inbox utilization
              </CardTitle>
              <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
                Capacity ROI · reassign idle inboxes · push underused senders
              </CardDescription>
            </div>
            {!wall ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setDetailOpen(true)}
                aria-label="Open full inbox utilization"
                title="Open full inbox utilization"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {summary && !loading ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal tabular-nums">
                {fmtNumber(summary.mailboxCount)} inboxes
              </Badge>
              {summary.needsAttention > 0 ? (
                <Badge
                  variant="outline"
                  className="h-5 border-destructive/30 bg-destructive/5 px-1.5 text-[10px] font-normal text-destructive tabular-nums"
                >
                  {fmtNumber(summary.needsAttention)} need attention
                </Badge>
              ) : null}
              {summary.totalCapacityToday != null ? (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal tabular-nums">
                  {fmtNumber(summary.totalSentToday)}/{fmtNumber(summary.totalCapacityToday)} today
                </Badge>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className={cn("pt-0", wall && "min-h-0 flex-1 overflow-y-auto")}>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
              <Inbox className="h-3.5 w-3.5 animate-pulse" />
              Loading mailbox capacity…
            </div>
          ) : error ? (
            <p className="py-6 text-center text-xs text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No mailboxes yet. Connect inboxes in Settings → Email.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <Column title="Needs attention" empty="All inboxes look healthy" wall={wall}>
                {needs.map((row) => (
                  <MiniRow key={`need-${row.ownerUid}:${row.mailboxId}`} row={row} />
                ))}
              </Column>
              <Column title="Well utilized" empty="No strong senders yet" wall={wall}>
                {best.map((row) => (
                  <MiniRow key={`best-${row.ownerUid}:${row.mailboxId}`} row={row} />
                ))}
              </Column>
            </div>
          )}
        </CardContent>
      </Card>

      {!wall ? (
        <MailboxUtilizationDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          rows={rows}
          summary={summary}
        />
      ) : null}
    </>
  );
}
