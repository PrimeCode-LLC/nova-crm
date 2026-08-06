"use client";

import * as React from "react";
import { Maximize2, Inbox } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/common/user-chip";
import { MailboxUtilizationDialog } from "@/components/dashboard/mailbox-utilization-dialog";
import { MailboxUtilizationSettings } from "@/components/dashboard/mailbox-utilization-settings";
import { useMailboxUtilization } from "@/hooks/use-mailbox-utilization";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import {
  MAILBOX_UTILIZATION_STATUS_LABEL,
  pickNeedsAttentionRows,
  pickWellUtilizedRows,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
  type MailboxUtilizationStatus,
} from "@/lib/email/mailbox-utilization";
import { isMailboxUtilizationVisible } from "@/lib/dashboard-preferences";
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
  scope: scopeProp,
}: {
  isDemo: boolean;
  currentUserId: string;
  wall?: boolean;
  className?: string;
  /** Prefer API scope; pass "mine" on the frontline board for correct empty-state copy. */
  scope?: "org" | "mine";
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const { rows, loading, error, scope: apiScope } = useMailboxUtilization({
    enabled: true,
    isDemo,
    currentUserId,
    // Utilization often takes 60s+ and saturates Admin SDK — keep it far off the boot path.
    deferMs: 45_000,
  });
  const scope = scopeProp ?? apiScope;
  const isMine = scope === "mine";
  const {
    prefs,
    setMailboxUtilizationVisible,
    setAllMailboxUtilizationVisible,
  } = useDashboardPreferences(currentUserId || "anon");

  const settingsOptions = React.useMemo(
    () =>
      rows.map((row) => ({
        ownerUid: row.ownerUid,
        mailboxId: row.mailboxId,
        label: row.label,
        emailAddress: row.emailAddress,
      })),
    [rows],
  );

  const mailboxVisibility = prefs.mailboxUtilizationVisible ?? {};

  const visibleRows = React.useMemo(
    () =>
      rows.filter((row) =>
        isMailboxUtilizationVisible(mailboxVisibility, row.ownerUid, row.mailboxId),
      ),
    [rows, mailboxVisibility],
  );

  const summary = React.useMemo(
    () => (visibleRows.length ? summarizeMailboxUtilization(visibleRows) : null),
    [visibleRows],
  );

  const needs = React.useMemo(
    () => pickNeedsAttentionRows(visibleRows, wall ? 6 : 3),
    [visibleRows, wall],
  );
  const best = React.useMemo(
    () => pickWellUtilizedRows(visibleRows, wall ? 6 : 3),
    [visibleRows, wall],
  );

  const allKeys = React.useMemo(
    () => rows.map((row) => ({ ownerUid: row.ownerUid, mailboxId: row.mailboxId })),
    [rows],
  );

  return (
    <>
      <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
        <CardHeader className={cn("pb-2", wall && "shrink-0")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
                {isMine ? "My inbox performance" : "Inbox utilization"}
              </CardTitle>
              <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
                {isMine
                  ? "Your assigned inboxes · top senders and ones needing attention"
                  : "Capacity ROI · reassign idle inboxes · push underused senders"}
              </CardDescription>
            </div>
            {!wall ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <MailboxUtilizationSettings
                  mailboxes={settingsOptions}
                  visible={mailboxVisibility}
                  onChange={setMailboxUtilizationVisible}
                  onShowAll={() => setAllMailboxUtilizationVisible(allKeys, true)}
                  onHideAll={() => setAllMailboxUtilizationVisible(allKeys, false)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setDetailOpen(true)}
                  aria-label="Open full inbox utilization"
                  title="Open full inbox utilization"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </div>
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
                  {fmtNumber(summary.totalSentToday + summary.totalPendingToday)}/
                  {fmtNumber(summary.totalCapacityToday)} booked today
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
              {isMine
                ? "No inboxes assigned to you yet. Ask an owner to assign one in Settings → Email."
                : "No mailboxes yet. Connect inboxes in Settings → Email."}
            </p>
          ) : visibleRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              All inboxes are hidden. Use settings to show some again.
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
          rows={visibleRows}
          summary={summary}
        />
      ) : null}
    </>
  );
}
