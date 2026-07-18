"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserChip } from "@/components/common/user-chip";
import {
  MAILBOX_UTILIZATION_STATUS_LABEL,
  mailboxAttentionRank,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
  type MailboxUtilizationStatus,
  type MailboxUtilizationSummary,
} from "@/lib/email/mailbox-utilization";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusTone(status: MailboxUtilizationStatus): string {
  switch (status) {
    case "hot":
      return "border-chart-1/30 bg-chart-1/10 text-foreground";
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "underused":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "idle":
    case "unassigned":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "unlimited":
      return "border-border bg-muted/40 text-muted-foreground";
    case "disabled":
      return "border-border bg-muted/20 text-muted-foreground";
    default:
      return "";
  }
}

function UtilBar({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const capped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            value >= 85 ? "bg-chart-1" : value >= 40 ? "bg-emerald-500" : "bg-amber-500",
          )}
          style={{ width: `${capped}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {fmtPercent(value, value % 1 === 0 ? 0 : 1)}
      </span>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "warn" | "ok" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/5",
        (!tone || tone === "muted") && "border-border bg-muted/30",
      )}
    >
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function MailboxUtilizationDialog({
  open,
  onOpenChange,
  rows,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: MailboxUtilizationRow[];
  summary: MailboxUtilizationSummary | null;
}) {
  const stats = summary ?? summarizeMailboxUtilization(rows);
  const sorted = React.useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rank = mailboxAttentionRank(b.status) - mailboxAttentionRank(a.status);
        if (rank !== 0) return rank;
        const ua = a.utilizationWeek ?? 999;
        const ub = b.utilizationWeek ?? 999;
        return ua - ub;
      }),
    [rows],
  );

  const capacityLabel =
    stats.totalCapacityToday != null
      ? `${fmtNumber(stats.totalSentToday)} / ${fmtNumber(stats.totalCapacityToday)}`
      : fmtNumber(stats.totalSentToday);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "flex h-[min(92vh,56rem)] w-[min(98vw,80rem)] max-w-[min(98vw,80rem)] flex-col gap-0 overflow-hidden p-0",
          "sm:max-w-[min(98vw,80rem)]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-3 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base">Inbox utilization</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Capacity ROI across every connected mailbox — reassign idle inboxes or push assignees
                who are leaving limit on the table.
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/settings?tab=email" />}
              nativeButton={false}
            >
              Manage inboxes
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatChip label="Inboxes" value={stats.mailboxCount} />
            <StatChip label="Needs attention" value={stats.needsAttention} tone="danger" />
            <StatChip label="Well utilized" value={stats.wellUtilized} tone="ok" />
            <StatChip label="Unassigned" value={stats.unassigned} tone="warn" />
            <StatChip label="Sent today / capacity" value={capacityLabel} tone="muted" />
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 sm:p-5">
            {sorted.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No mailboxes found. Connect inboxes in Settings → Email.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9">Inbox</TableHead>
                    <TableHead className="h-9">Assignees</TableHead>
                    <TableHead className="h-9 text-right">Limit</TableHead>
                    <TableHead className="h-9 text-right">Today</TableHead>
                    <TableHead className="h-9 text-right">Week</TableHead>
                    <TableHead className="h-9 text-right">Avg / day</TableHead>
                    <TableHead className="h-9">Util (7d)</TableHead>
                    <TableHead className="h-9 text-right">Queued</TableHead>
                    <TableHead className="h-9">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => (
                    <TableRow key={`${row.ownerUid}:${row.mailboxId}`}>
                      <TableCell className="py-2.5 align-top">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.label}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {row.emailAddress || "—"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        {row.assignedUserIds.length === 0 ? (
                          <span className="text-xs text-destructive">Unassigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.assignedUserIds.map((uid) => (
                              <UserChip key={uid} userId={uid} />
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums align-top">
                        {row.dailySendLimit != null ? fmtNumber(row.dailySendLimit) : "—"}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums align-top font-medium">
                        {fmtNumber(row.sentToday)}
                        {row.utilizationToday != null ? (
                          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                            {fmtPercent(row.utilizationToday, 0)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums align-top">
                        {fmtNumber(row.sentWeek)}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums align-top text-muted-foreground">
                        {fmtNumber(row.avgDailyWeek)}
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <UtilBar value={row.utilizationWeek} />
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums align-top text-muted-foreground">
                        {fmtNumber(row.pendingToday)}
                        {row.pendingWeek > row.pendingToday ? (
                          <span className="mt-0.5 block text-[10px]">
                            {fmtNumber(row.pendingWeek)} / 7d
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <Badge
                          variant="outline"
                          className={cn("h-5 px-1.5 text-[10px] font-normal", statusTone(row.status))}
                        >
                          {MAILBOX_UTILIZATION_STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
