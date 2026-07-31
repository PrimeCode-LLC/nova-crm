"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import {
  REPLY_ACTION_STATUS_LABELS,
  REPLY_RECOMMENDED_ACTION_LABELS,
  type ReplyActionDrillRow,
  type ReplyAnalyticsRangeKey,
  type ReplyLeadOutcome,
} from "@/lib/email/reply-action-analytics";
import { REPLY_CLASS_LABELS, type ReplyClass } from "@/lib/email/reply-action-types";
import { cn } from "@/lib/utils";

export type ReplyActionsDrillQuery = {
  title: string;
  description?: string;
  range: ReplyAnalyticsRangeKey;
  /** Page-level filters; drill overlays narrower values when set. */
  classification?: string;
  status?: string;
  recommendedAction?: string;
  draftStatus?: string;
  ownerId?: string;
  outcome?: ReplyLeadOutcome;
  day?: string;
  decidedOnly?: boolean;
  winRateCohort?: boolean;
};

function outcomeTone(outcome: ReplyLeadOutcome): string {
  if (outcome === "won") return "border-success/30 bg-success/10 text-success";
  if (outcome === "lost") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-muted/40 text-muted-foreground";
}

function statusTone(status: string): string {
  switch (status) {
    case "pending":
      return "border-warning/30 bg-warning/10 text-warning";
    case "sent":
      return "border-success/30 bg-success/10 text-success";
    case "accepted":
      return "border-chart-1/30 bg-chart-1/10 text-foreground";
    case "dismissed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function leadLabel(row: ReplyActionDrillRow): string {
  const name = row.leadContactName?.trim();
  const company = row.leadCompanyName?.trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || row.inboundFrom || "Lead";
}

export function ReplyActionsDrillDialog({
  open,
  onOpenChange,
  query,
  memberLabels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: ReplyActionsDrillQuery | null;
  memberLabels: Record<string, string>;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [rows, setRows] = React.useState<ReplyActionDrillRow[]>([]);

  React.useEffect(() => {
    if (!open || !query) {
      setRows([]);
      setError("");
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          range: query.range,
          includeRows: "1",
          classification: query.classification && query.classification !== "all"
            ? query.classification
            : "all",
          status: query.status && query.status !== "all" ? query.status : "all",
        });
        if (query.recommendedAction) params.set("recommendedAction", query.recommendedAction);
        if (query.draftStatus) params.set("draftStatus", query.draftStatus);
        if (query.ownerId) params.set("ownerId", query.ownerId);
        if (query.outcome) params.set("outcome", query.outcome);
        if (query.day) params.set("day", query.day);
        if (query.decidedOnly) params.set("decidedOnly", "1");
        if (query.winRateCohort) params.set("winRateCohort", "1");

        const response = await fetch(`/api/email/reply-actions/analytics?${params}`, {
          credentials: "same-origin",
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          rows?: ReplyActionDrillRow[];
        };
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Could not load reply actions");
        }
        if (!cancelled) {
          setRows(
            [...(data.rows ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Could not load reply actions");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "flex h-[min(92vh,52rem)] w-[min(98vw,72rem)] max-w-[min(98vw,72rem)] flex-col gap-0 overflow-hidden p-0",
          "sm:max-w-[min(98vw,72rem)]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle className="text-base">{query?.title ?? "Reply actions"}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {query?.description ??
              "Individual reply actions that make up this metric. Open a lead to review or act."}
          </DialogDescription>
          {!loading && !error ? (
            <p className="pt-1 text-xs text-muted-foreground tabular-nums">
              {fmtNumber(rows.length)} action{rows.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading actions…
              </div>
            ) : error ? (
              <p className="py-12 text-center text-sm text-destructive">{error}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No reply actions match this slice.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9">Lead</TableHead>
                    <TableHead className="h-9">Class</TableHead>
                    <TableHead className="h-9">Status</TableHead>
                    <TableHead className="h-9">Recommended</TableHead>
                    <TableHead className="h-9 text-right">Potential</TableHead>
                    <TableHead className="h-9">Owner</TableHead>
                    <TableHead className="h-9">Created</TableHead>
                    <TableHead className="h-9 w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const ownerId =
                      row.leadOwnerId || "unknown";
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[14rem] py-2.5 align-top">
                          <p className="truncate text-sm font-medium">{leadLabel(row)}</p>
                          {row.inboundSubject ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.inboundSubject}
                            </p>
                          ) : row.nextStepSummary ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.nextStepSummary}
                            </p>
                          ) : null}
                          {row.outcome !== "unknown" && row.outcome !== "open" ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-1 h-5 px-1.5 text-[10px] font-normal capitalize",
                                outcomeTone(row.outcome),
                              )}
                            >
                              {row.outcome}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2.5 align-top text-sm">
                          {REPLY_CLASS_LABELS[row.classification as ReplyClass] ??
                            row.classification}
                        </TableCell>
                        <TableCell className="py-2.5 align-top">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px] font-normal",
                              statusTone(row.status),
                            )}
                          >
                            {REPLY_ACTION_STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 align-top text-sm text-muted-foreground">
                          {REPLY_RECOMMENDED_ACTION_LABELS[row.recommendedAction] ??
                            row.recommendedAction}
                        </TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums align-top">
                          {fmtNumber(Math.round(row.potentialScore))}
                        </TableCell>
                        <TableCell className="max-w-[8rem] truncate py-2.5 align-top text-sm text-muted-foreground">
                          {memberLabels[ownerId] || (ownerId === "unknown" ? "—" : ownerId)}
                        </TableCell>
                        <TableCell className="py-2.5 align-top text-sm text-muted-foreground">
                          <span title={fmtDate(row.createdAt)}>{fmtRelative(row.createdAt)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 align-top">
                          <Link
                            href={`/leads/${row.leadId}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Open
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
