"use client";

import * as React from "react";
import {
  BarChart3,
  Briefcase,
  GitBranch,
  Loader2,
  Mail,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
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
import { CHANNEL_LIST } from "@/lib/constants";
import { fmtNumber } from "@/lib/format";
import type { AuditAnalyticsResult } from "@/lib/audit-analytics";

const CATEGORY_LABELS: Record<string, string> = {
  team: "Team",
  crm: "CRM",
  ai: "AI",
  integrations: "Integrations",
  settings: "Settings",
  usage: "Feature usage",
};

function channelLabel(key: string): string {
  const known = CHANNEL_LIST.find((c) => c.key === key);
  if (known) return known.label;
  if (key.startsWith("custom_")) return key.slice("custom_".length);
  return key;
}

function FunnelBar({
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
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{fmtNumber(count)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ActivityLogsDashboard({
  analytics,
  memberLabels,
  loading,
  channelFilter,
}: {
  analytics: AuditAnalyticsResult | null;
  memberLabels: Record<string, string>;
  loading: boolean;
  channelFilter: string;
}) {
  if (loading && !analytics) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading analytics…
      </div>
    );
  }

  if (!analytics) return null;

  const { kpis, byCategory, channelFunnels, stageTransitions, dailyTrend, byPerson } = analytics;

  const selectedFunnel =
    channelFilter !== "all"
      ? channelFunnels.find((f) => f.channel === channelFilter)
      : (channelFunnels.find((f) => f.channel === "upwork") ?? channelFunnels[0]);

  const funnelMax = selectedFunnel
    ? Math.max(...Object.values(selectedFunnel.stages), 1)
    : 1;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Total events" value={fmtNumber(kpis.totalEvents)} icon={BarChart3} />
        <KpiCard label="Stage changes" value={fmtNumber(kpis.stageChanges)} icon={GitBranch} />
        <KpiCard
          label="Leads / prospects created"
          value={fmtNumber(kpis.leadsCreated)}
          icon={Briefcase}
        />
        <KpiCard
          label="Activity rollups logged"
          value={fmtNumber(kpis.countersLogged)}
          hint="From audit log entries"
          icon={TrendingUp}
        />
        <KpiCard label="Deals won" value={fmtNumber(kpis.dealsWon)} icon={Zap} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="AI tool usage" value={fmtNumber(kpis.aiActions)} icon={Sparkles} />
        <KpiCard label="Integration actions" value={fmtNumber(kpis.integrationActions)} icon={Mail} />
        <KpiCard label="Page visits" value={fmtNumber(kpis.pageViews)} icon={Users} />
        <KpiCard label="Team admin actions" value={fmtNumber(kpis.teamActions)} icon={Users} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {selectedFunnel ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                Channel funnel · {channelLabel(selectedFunnel.channel)}
              </CardTitle>
              <CardDescription className="text-xs">
                Derived from activity log: counter rollups, lead creation, and stage changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(selectedFunnel.stages).map(([key, count]) => (
                <FunnelBar
                  key={key}
                  label={key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")}
                  count={count}
                  max={funnelMax}
                />
              ))}
              {Object.keys(selectedFunnel.stages).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No funnel data in this period. Log daily counters or move leads through stages.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Channel funnel</CardTitle>
              <CardDescription className="text-xs">
                Select a channel filter to see funnel metrics from the audit log.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground py-6 text-center">
                No channel-specific events in this period.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Events by category</CardTitle>
            <CardDescription className="text-xs">Breakdown of audit log categories.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => (
                  <Badge key={cat} variant="secondary" className="text-xs gap-1.5 py-1">
                    {CATEGORY_LABELS[cat] ?? cat}
                    <span className="font-semibold tabular-nums">{count}</span>
                  </Badge>
                ))}
              {Object.keys(byCategory).length === 0 ? (
                <p className="text-sm text-muted-foreground">No events in range.</p>
              ) : null}
            </div>

            {stageTransitions.length > 0 ? (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Top stage transitions</p>
                {stageTransitions.slice(0, 6).map((t) => (
                  <div key={t.label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground truncate pr-2">{t.label}</span>
                    <span className="font-medium tabular-nums shrink-0">{t.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {channelFilter === "upwork" || selectedFunnel?.channel === "upwork" ? (
        <Card className="border-dashed">
          <CardContent className="py-3 px-4 text-xs text-muted-foreground">
            Upwork metrics from audit log: <strong>Applied</strong> = counter rollups + new leads;{" "}
            <strong>Viewed</strong> = stage → Contacted or counter; <strong>Replied</strong> = stage
            → Replied; <strong>Hired</strong> = stage → Won or deal won.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Team activity</CardTitle>
            <CardDescription className="text-xs">
              Per-person totals from the audit log in the selected period.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {byPerson.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Stages</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Rollups</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byPerson.slice(0, 10).map((row) => (
                    <TableRow key={row.actorUid}>
                      <TableCell className="text-sm font-medium truncate max-w-[160px]">
                        {(memberLabels[row.actorUid] ?? row.actorUid) || "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmtNumber(row.totalEvents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmtNumber(row.stageChanges)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmtNumber(row.leadsCreated)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmtNumber(row.countersLogged)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Daily volume</CardTitle>
            <CardDescription className="text-xs">Audit events per day in range.</CardDescription>
          </CardHeader>
          <CardContent>
            {dailyTrend.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No daily data.</p>
            ) : (
              <div className="flex items-end gap-1 h-[140px]">
                {dailyTrend.map((d) => {
                  const max = Math.max(...dailyTrend.map((x) => x.count), 1);
                  const h = Math.max(4, Math.round((d.count / max) * 120));
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div
                        className="w-full rounded-t bg-primary/60"
                        style={{ height: h }}
                        title={`${d.day}: ${d.count}`}
                      />
                      <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                        {d.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
