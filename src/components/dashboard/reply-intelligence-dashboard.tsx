"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  MailCheck,
  Percent,
  Sparkles,
  Target,
  ThumbsDown,
  TrendingUp,
} from "lucide-react";

import { KpiCard } from "@/components/common/kpi-card";
import {
  ReplyActionsDrillDialog,
  type ReplyActionsDrillQuery,
} from "@/components/dashboard/reply-actions-drill-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNumber, fmtPercent } from "@/lib/format";
import {
  type ReplyAnalyticsRangeKey,
  type ReplyIntelligenceAnalytics,
  type ReplyLeadOutcome,
} from "@/lib/email/reply-action-analytics";
import { REPLY_CLASS_LABELS, type ReplyClass } from "@/lib/email/reply-action-types";
import { cn } from "@/lib/utils";

function MixBar({
  label,
  count,
  max,
  onClick,
}: {
  label: string;
  count: number;
  max: number;
  onClick?: () => void;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const interactive = Boolean(onClick) && count > 0;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={cn(
        "w-full space-y-1 rounded-md text-left transition-colors",
        interactive && "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !interactive && "cursor-default",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {fmtNumber(count)}
          {max > 0 ? (
            <span className="ml-1 text-muted-foreground">({pct}%)</span>
          ) : null}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

function TrendBars({
  points,
  onDayClick,
}: {
  points: ReplyIntelligenceAnalytics["dailyTrend"];
  onDayClick?: (day: string, count: number) => void;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  }
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {points.map((p) => {
        const interactive = Boolean(onDayClick) && p.count > 0;
        return (
          <button
            key={p.day}
            type="button"
            disabled={!interactive}
            title={`${p.day}: ${p.count} actions, ${p.sent} sent`}
            onClick={() => onDayClick?.(p.day, p.count)}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm",
              interactive &&
                "cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !interactive && "cursor-default",
            )}
          >
            <div className="flex h-28 w-full flex-col justify-end gap-0.5">
              <div
                className="w-full rounded-t bg-primary/80"
                style={{ height: `${Math.max(4, Math.round((p.count / max) * 100))}%` }}
              />
            </div>
            <span className="truncate text-[10px] text-muted-foreground">
              {p.day.slice(5)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DrillCell({
  value,
  onClick,
  className,
}: {
  value: number;
  onClick?: () => void;
  className?: string;
}) {
  const interactive = Boolean(onClick) && value > 0;
  if (!interactive) {
    return <span className={cn("tabular-nums", className)}>{fmtNumber(value)}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-1 py-0.5 tabular-nums text-primary underline-offset-2 hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {fmtNumber(value)}
    </button>
  );
}

export function ReplyIntelligenceDashboard({
  analytics,
  memberLabels,
  loading,
  range,
  classificationFilter,
  statusFilter,
}: {
  analytics: ReplyIntelligenceAnalytics | null;
  memberLabels: Record<string, string>;
  loading: boolean;
  range: ReplyAnalyticsRangeKey;
  classificationFilter: string;
  statusFilter: string;
}) {
  const [drill, setDrill] = React.useState<ReplyActionsDrillQuery | null>(null);

  const openDrill = React.useCallback(
    (partial: Omit<ReplyActionsDrillQuery, "range"> & { range?: ReplyAnalyticsRangeKey }) => {
      setDrill({
        title: partial.title,
        description: partial.description,
        range: partial.range ?? range,
        classification:
          partial.classification ??
          (classificationFilter !== "all" ? classificationFilter : undefined),
        status:
          partial.status ?? (statusFilter !== "all" ? statusFilter : undefined),
        recommendedAction: partial.recommendedAction,
        draftStatus: partial.draftStatus,
        ownerId: partial.ownerId,
        outcome: partial.outcome,
        day: partial.day,
        decidedOnly: partial.decidedOnly,
        winRateCohort: partial.winRateCohort,
      });
    },
    [classificationFilter, range, statusFilter],
  );

  if (loading && !analytics) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading reply intelligence…
      </div>
    );
  }

  if (!analytics) return null;

  const { kpis } = analytics;
  const classMax = Math.max(...analytics.byClassification.map((r) => r.count), 0);
  const statusMax = Math.max(...analytics.byStatus.map((r) => r.count), 0);
  const actionMax = Math.max(...analytics.byRecommendedAction.map((r) => r.count), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Reply actions"
          value={fmtNumber(kpis.total)}
          icon={Sparkles}
          tone="accent"
          hint="Click to list"
          onClick={() =>
            openDrill({
              title: "All reply actions",
              description: "Every AI reply action in the current filters.",
            })
          }
        />
        <KpiCard
          label="Pending review"
          value={fmtNumber(kpis.pending)}
          icon={Clock3}
          tone="warn"
          hint="Click to list"
          onClick={() =>
            openDrill({
              title: "Pending review",
              description: "Reply actions waiting for approve, edit, or dismiss.",
              status: "pending",
            })
          }
        />
        <KpiCard
          label="Sent replies"
          value={fmtNumber(kpis.sent)}
          icon={MailCheck}
          tone="success"
          hint="Click to list"
          onClick={() =>
            openDrill({
              title: "Sent replies",
              description: "Reply actions that were sent to the lead.",
              status: "sent",
            })
          }
        />
        <KpiCard
          label="Send rate"
          value={kpis.sendRate == null ? "—" : fmtPercent(kpis.sendRate)}
          icon={Percent}
          tone="info"
          hint="Click to see sent"
          onClick={() =>
            openDrill({
              title: "Sent replies (send rate)",
              description: "Actions counted in the send-rate numerator.",
              status: "sent",
            })
          }
        />
        <KpiCard
          label="Avg potential"
          value={kpis.avgPotential == null ? "—" : fmtNumber(Math.round(kpis.avgPotential))}
          icon={Target}
          hint="Click to list"
          onClick={() =>
            openDrill({
              title: "Reply actions by potential",
              description: "All actions contributing to average potential score.",
            })
          }
        />
        <KpiCard
          label="Avg decision time"
          value={
            kpis.avgDecisionHours == null
              ? "—"
              : `${kpis.avgDecisionHours < 24 ? kpis.avgDecisionHours.toFixed(1) + "h" : (kpis.avgDecisionHours / 24).toFixed(1) + "d"}`
          }
          icon={Clock3}
          hint="Click to list"
          onClick={() =>
            openDrill({
              title: "Decided reply actions",
              description: "Actions with a decision or send timestamp (decision-time sample).",
              decidedOnly: true,
            })
          }
        />
        <KpiCard
          label="Dismiss rate"
          value={kpis.dismissRate == null ? "—" : fmtPercent(kpis.dismissRate)}
          icon={ThumbsDown}
          tone="danger"
          hint="Click to see dismissed"
          onClick={() =>
            openDrill({
              title: "Dismissed replies",
              description: "Actions counted in the dismiss-rate numerator.",
              status: "dismissed",
            })
          }
        />
        <KpiCard
          label="Win rate (sent/accepted)"
          value={kpis.winRateAmongDecided == null ? "—" : fmtPercent(kpis.winRateAmongDecided)}
          icon={TrendingUp}
          tone="success"
          hint="Click to see cohort"
          onClick={() =>
            openDrill({
              title: "Win-rate cohort",
              description: "Sent or accepted actions whose lead is now won or lost.",
              winRateCohort: true,
            })
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By classification</CardTitle>
            <CardDescription>How inbound replies were labeled — click a class</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byClassification.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classifications yet.</p>
            ) : (
              analytics.byClassification.map((row) => (
                <MixBar
                  key={row.key}
                  label={row.label}
                  count={row.count}
                  max={classMax}
                  onClick={() =>
                    openDrill({
                      title: `${row.label} replies`,
                      description: `Reply actions classified as ${row.label}.`,
                      classification: row.key,
                    })
                  }
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By status</CardTitle>
            <CardDescription>Approval and send outcomes — click a status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No statuses yet.</p>
            ) : (
              analytics.byStatus.map((row) => (
                <MixBar
                  key={row.key}
                  label={row.label}
                  count={row.count}
                  max={statusMax}
                  onClick={() =>
                    openDrill({
                      title: `${row.label} actions`,
                      description: `Reply actions with status ${row.label}.`,
                      status: row.key,
                    })
                  }
                />
              ))
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge
                variant="outline"
                className={cn(kpis.draftReady > 0 && "cursor-pointer hover:bg-muted")}
                role={kpis.draftReady > 0 ? "button" : undefined}
                tabIndex={kpis.draftReady > 0 ? 0 : undefined}
                onClick={() => {
                  if (kpis.draftReady <= 0) return;
                  openDrill({
                    title: "Drafts ready",
                    description: "Reply actions with a ready AI draft.",
                    draftStatus: "ready",
                  });
                }}
                onKeyDown={(e) => {
                  if (kpis.draftReady <= 0) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrill({
                      title: "Drafts ready",
                      description: "Reply actions with a ready AI draft.",
                      draftStatus: "ready",
                    });
                  }
                }}
              >
                Drafts ready {fmtNumber(kpis.draftReady)}
              </Badge>
              <Badge
                variant="outline"
                className={cn(kpis.draftFailed > 0 && "cursor-pointer hover:bg-muted")}
                role={kpis.draftFailed > 0 ? "button" : undefined}
                tabIndex={kpis.draftFailed > 0 ? 0 : undefined}
                onClick={() => {
                  if (kpis.draftFailed <= 0) return;
                  openDrill({
                    title: "Draft failed",
                    description: "Reply actions where draft generation failed.",
                    draftStatus: "failed",
                  });
                }}
                onKeyDown={(e) => {
                  if (kpis.draftFailed <= 0) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrill({
                      title: "Draft failed",
                      description: "Reply actions where draft generation failed.",
                      draftStatus: "failed",
                    });
                  }
                }}
              >
                Draft failed {fmtNumber(kpis.draftFailed)}
              </Badge>
              <Badge
                variant="secondary"
                className={cn(kpis.accepted > 0 && "cursor-pointer hover:bg-muted")}
                role={kpis.accepted > 0 ? "button" : undefined}
                tabIndex={kpis.accepted > 0 ? 0 : undefined}
                onClick={() => {
                  if (kpis.accepted <= 0) return;
                  openDrill({
                    title: "Accepted replies",
                    description: "Reply actions marked accepted.",
                    status: "accepted",
                  });
                }}
                onKeyDown={(e) => {
                  if (kpis.accepted <= 0) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrill({
                      title: "Accepted replies",
                      description: "Reply actions marked accepted.",
                      status: "accepted",
                    });
                  }
                }}
              >
                Accepted {fmtNumber(kpis.accepted)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recommended action</CardTitle>
            <CardDescription>What the model suggested next — click a row</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byRecommendedAction.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recommendations yet.</p>
            ) : (
              analytics.byRecommendedAction.map((row) => (
                <MixBar
                  key={row.key}
                  label={row.label}
                  count={row.count}
                  max={actionMax}
                  onClick={() =>
                    openDrill({
                      title: `${row.label}`,
                      description: `Actions where the model recommended “${row.label}”.`,
                      recommendedAction: row.key,
                    })
                  }
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Daily volume</CardTitle>
          <CardDescription>
            Reply actions created per day (taller = more) — click a day
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrendBars
            points={analytics.dailyTrend}
            onDayClick={(day, count) =>
              openDrill({
                title: `Actions on ${day}`,
                description: `${fmtNumber(count)} reply action${count === 1 ? "" : "s"} created that day.`,
                day,
              })
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Outcomes by class</CardTitle>
          <CardDescription>
            Join to lead stage after accept/send — click a number to list those actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.classOutcomes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No class outcomes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Lost</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                  <TableHead className="text-right">Avg potential</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.classOutcomes.map((row) => {
                  const classLabel =
                    REPLY_CLASS_LABELS[row.classification as ReplyClass] ?? row.label;
                  const classDrill = (extra: Partial<ReplyActionsDrillQuery>, title: string) =>
                    openDrill({
                      title,
                      description: `${classLabel} · ${title}`,
                      classification: row.classification,
                      ...extra,
                    });
                  return (
                    <TableRow key={row.classification}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            classDrill({}, `${classLabel} — all actions`)
                          }
                        >
                          {row.label}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.total}
                          onClick={() => classDrill({}, `${classLabel} — all actions`)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.sent}
                          onClick={() =>
                            classDrill({ status: "sent" }, `${classLabel} — sent`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.pending}
                          onClick={() =>
                            classDrill({ status: "pending" }, `${classLabel} — pending`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-success">
                        <DrillCell
                          value={row.won}
                          className="text-success"
                          onClick={() =>
                            classDrill(
                              { outcome: "won" as ReplyLeadOutcome },
                              `${classLabel} — won`,
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        <DrillCell
                          value={row.lost}
                          className="text-destructive"
                          onClick={() =>
                            classDrill(
                              { outcome: "lost" as ReplyLeadOutcome },
                              `${classLabel} — lost`,
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.winRate == null ? "—" : fmtPercent(row.winRate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.avgPotential == null ? "—" : fmtNumber(Math.round(row.avgPotential))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By lead owner</CardTitle>
          <CardDescription>
            Who owns the opportunities these replies touched — click a number
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.byOwner.length === 0 ? (
            <p className="text-sm text-muted-foreground">No owner breakdown yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Dismissed</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Lost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.byOwner.map((row) => {
                  const ownerName = memberLabels[row.ownerId] || row.ownerId;
                  const ownerDrill = (
                    extra: Partial<ReplyActionsDrillQuery>,
                    title: string,
                  ) =>
                    openDrill({
                      title,
                      description: `Owned by ${ownerName}`,
                      ownerId: row.ownerId,
                      ...extra,
                    });
                  return (
                    <TableRow key={row.ownerId}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => ownerDrill({}, `${ownerName} — all actions`)}
                        >
                          {ownerName}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.total}
                          onClick={() => ownerDrill({}, `${ownerName} — all actions`)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.sent}
                          onClick={() =>
                            ownerDrill({ status: "sent" }, `${ownerName} — sent`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.accepted}
                          onClick={() =>
                            ownerDrill({ status: "accepted" }, `${ownerName} — accepted`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.dismissed}
                          onClick={() =>
                            ownerDrill({ status: "dismissed" }, `${ownerName} — dismissed`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DrillCell
                          value={row.pending}
                          onClick={() =>
                            ownerDrill({ status: "pending" }, `${ownerName} — pending`)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-success">
                        <DrillCell
                          value={row.won}
                          className="text-success"
                          onClick={() =>
                            ownerDrill(
                              { outcome: "won" as ReplyLeadOutcome },
                              `${ownerName} — won`,
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        <DrillCell
                          value={row.lost}
                          className="text-destructive"
                          onClick={() =>
                            ownerDrill(
                              { outcome: "lost" as ReplyLeadOutcome },
                              `${ownerName} — lost`,
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReplyActionsDrillDialog
        open={Boolean(drill)}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
        query={drill}
        memberLabels={memberLabels}
      />
    </div>
  );
}
