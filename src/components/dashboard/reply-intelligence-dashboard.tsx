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
import type { ReplyIntelligenceAnalytics } from "@/lib/email/reply-action-analytics";

function MixBar({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
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
    </div>
  );
}

function TrendBars({
  points,
}: {
  points: ReplyIntelligenceAnalytics["dailyTrend"];
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  }
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {points.map((p) => (
        <div key={p.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-28 w-full flex-col justify-end gap-0.5">
            <div
              className="w-full rounded-t bg-primary/80"
              style={{ height: `${Math.max(4, Math.round((p.count / max) * 100))}%` }}
              title={`${p.day}: ${p.count} actions, ${p.sent} sent`}
            />
          </div>
          <span className="truncate text-[10px] text-muted-foreground">
            {p.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReplyIntelligenceDashboard({
  analytics,
  memberLabels,
  loading,
}: {
  analytics: ReplyIntelligenceAnalytics | null;
  memberLabels: Record<string, string>;
  loading: boolean;
}) {
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
        <KpiCard label="Reply actions" value={fmtNumber(kpis.total)} icon={Sparkles} tone="accent" />
        <KpiCard label="Pending review" value={fmtNumber(kpis.pending)} icon={Clock3} tone="warn" />
        <KpiCard label="Sent replies" value={fmtNumber(kpis.sent)} icon={MailCheck} tone="success" />
        <KpiCard
          label="Send rate"
          value={kpis.sendRate == null ? "—" : fmtPercent(kpis.sendRate)}
          icon={Percent}
          tone="info"
        />
        <KpiCard
          label="Avg potential"
          value={kpis.avgPotential == null ? "—" : fmtNumber(Math.round(kpis.avgPotential))}
          icon={Target}
        />
        <KpiCard
          label="Avg decision time"
          value={
            kpis.avgDecisionHours == null
              ? "—"
              : `${kpis.avgDecisionHours < 24 ? kpis.avgDecisionHours.toFixed(1) + "h" : (kpis.avgDecisionHours / 24).toFixed(1) + "d"}`
          }
          icon={Clock3}
        />
        <KpiCard
          label="Dismiss rate"
          value={kpis.dismissRate == null ? "—" : fmtPercent(kpis.dismissRate)}
          icon={ThumbsDown}
          tone="danger"
        />
        <KpiCard
          label="Win rate (sent/accepted)"
          value={kpis.winRateAmongDecided == null ? "—" : fmtPercent(kpis.winRateAmongDecided)}
          icon={TrendingUp}
          tone="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By classification</CardTitle>
            <CardDescription>How inbound replies were labeled</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byClassification.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classifications yet.</p>
            ) : (
              analytics.byClassification.map((row) => (
                <MixBar key={row.key} label={row.label} count={row.count} max={classMax} />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By status</CardTitle>
            <CardDescription>Approval and send outcomes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No statuses yet.</p>
            ) : (
              analytics.byStatus.map((row) => (
                <MixBar key={row.key} label={row.label} count={row.count} max={statusMax} />
              ))
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant="outline">Drafts ready {fmtNumber(kpis.draftReady)}</Badge>
              <Badge variant="outline">Draft failed {fmtNumber(kpis.draftFailed)}</Badge>
              <Badge variant="secondary">Accepted {fmtNumber(kpis.accepted)}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recommended action</CardTitle>
            <CardDescription>What the model suggested next</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.byRecommendedAction.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recommendations yet.</p>
            ) : (
              analytics.byRecommendedAction.map((row) => (
                <MixBar key={row.key} label={row.label} count={row.count} max={actionMax} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Daily volume</CardTitle>
          <CardDescription>Reply actions created per day (taller = more)</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendBars points={analytics.dailyTrend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Outcomes by class</CardTitle>
          <CardDescription>
            Join to lead stage after accept/send — fuel for strategy packs
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
                {analytics.classOutcomes.map((row) => (
                  <TableRow key={row.classification}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.pending)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {fmtNumber(row.won)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {fmtNumber(row.lost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.winRate == null ? "—" : fmtPercent(row.winRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.avgPotential == null ? "—" : fmtNumber(Math.round(row.avgPotential))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By lead owner</CardTitle>
          <CardDescription>Who owns the opportunities these replies touched</CardDescription>
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
                {analytics.byOwner.map((row) => (
                  <TableRow key={row.ownerId}>
                    <TableCell className="font-medium">
                      {memberLabels[row.ownerId] || row.ownerId}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                        {fmtNumber(row.accepted)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.dismissed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumber(row.pending)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {fmtNumber(row.won)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {fmtNumber(row.lost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
