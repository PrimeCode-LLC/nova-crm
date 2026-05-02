"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/common/kpi-card";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { PipelineDistribution } from "@/components/dashboard/pipeline-distribution";
import { PersonScorecard } from "@/components/dashboard/person-scorecard";
import { IdleLeads } from "@/components/dashboard/idle-leads";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ChannelMix } from "@/components/dashboard/channel-mix";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useLocalActivityRollups } from "@/hooks/use-local-activity-rollups";
import { mergeActivityCounters } from "@/lib/activity-local-rollups";
import { aggregateChannelFunnelCounts } from "@/lib/dashboard-analytics";
import { downloadDashboardKpiCsv } from "@/lib/dashboard-csv";
import { CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { Target, Clock, DollarSign, TrendingUp, Inbox, Calendar, Download, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const { leads, deals, isDemo, activityCounters, activityRecords } = useWorkspace();
  const { localRollups } = useLocalActivityRollups();
  const activityCountersWithLocal = React.useMemo(
    () => mergeActivityCounters(activityCounters, localRollups),
    [activityCounters, localRollups],
  );
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [channelScope, setChannelScope] = React.useState<ChannelKey[]>([]);
  const [draftChannels, setDraftChannels] = React.useState<ChannelKey[]>([]);

  function openFilterDialog() {
    setDraftChannels(channelScope);
    setFilterOpen(true);
  }

  const scopedLeads = React.useMemo(
    () => (channelScope.length ? leads.filter((l) => channelScope.includes(l.channel)) : leads),
    [leads, channelScope],
  );

  const scopedLeadIds = React.useMemo(() => new Set(scopedLeads.map((l) => l.id)), [scopedLeads]);

  const scopedDeals = React.useMemo(
    () => (channelScope.length ? deals.filter((d) => scopedLeadIds.has(d.leadId)) : deals),
    [deals, channelScope, scopedLeadIds],
  );

  const scopedActivityCounters = React.useMemo(
    () =>
      channelScope.length
        ? activityCountersWithLocal.filter((r) => channelScope.includes(r.channel))
        : activityCountersWithLocal,
    [activityCountersWithLocal, channelScope],
  );

  const scopedActivityRecords = React.useMemo(
    () =>
      channelScope.length ? activityRecords.filter((r) => channelScope.includes(r.channel)) : activityRecords,
    [activityRecords, channelScope],
  );

  const totalOpen = scopedLeads.filter((l) => !["won", "lost"].includes(l.stage)).length;
  const idleCount = scopedLeads.filter((l) => l.isIdle).length;
  const avgResponseMin =
    scopedLeads.filter((l) => l.responseTimeMinutes != null).reduce((s, l) => s + (l.responseTimeMinutes ?? 0), 0) /
    Math.max(1, scopedLeads.filter((l) => l.responseTimeMinutes != null).length);
  const pipelineValue = scopedDeals
    .filter((d) => !["won", "lost"].includes(d.stage))
    .reduce((s, d) => s + d.value, 0);
  const closedValue = scopedDeals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);

  const coldEmailCounts = React.useMemo(
    () => aggregateChannelFunnelCounts("cold_email", scopedActivityCounters, scopedLeads, scopedDeals),
    [scopedActivityCounters, scopedLeads, scopedDeals],
  );
  const linkedinCounts = React.useMemo(
    () => aggregateChannelFunnelCounts("linkedin_outbound", scopedActivityCounters, scopedLeads, scopedDeals),
    [scopedActivityCounters, scopedLeads, scopedDeals],
  );
  const upworkCounts = React.useMemo(
    () => aggregateChannelFunnelCounts("upwork", scopedActivityCounters, scopedLeads, scopedDeals),
    [scopedActivityCounters, scopedLeads, scopedDeals],
  );
  const websiteCounts = React.useMemo(
    () => aggregateChannelFunnelCounts("website_form", scopedActivityCounters, scopedLeads, scopedDeals),
    [scopedActivityCounters, scopedLeads, scopedDeals],
  );

  function toggleDraft(ch: ChannelKey) {
    setDraftChannels((d) => (d.includes(ch) ? d.filter((x) => x !== ch) : [...d, ch]));
  }

  function applyChannelFilter() {
    setChannelScope(draftChannels);
    setFilterOpen(false);
    if (draftChannels.length) {
      toast.success("Overview filtered", {
        description: `${draftChannels.length} channel(s). Charts and KPIs now match this slice.`,
      });
    }
  }

  function exportOverviewCsv() {
    const scope =
      channelScope.length === 0
        ? "all channels"
        : channelScope.map((c) => CHANNEL_LIST.find((x) => x.key === c)?.label ?? c).join("; ");
    downloadDashboardKpiCsv(
      [
        { label: "Scope", value: scope },
        { label: "Open leads", value: String(totalOpen) },
        { label: "Pipeline value (USD)", value: String(Math.round(pipelineValue)) },
        { label: "Closed revenue (USD)", value: String(Math.round(closedValue)) },
        {
          label: "Open deals",
          value: String(scopedDeals.filter((d) => !["won", "lost"].includes(d.stage)).length),
        },
        { label: "Won deals", value: String(scopedDeals.filter((d) => d.stage === "won").length) },
        { label: "Idle leads", value: String(idleCount) },
        { label: "Avg response (minutes)", value: String(Math.round(avgResponseMin)) },
      ],
      "nova-dashboard-overview",
    );
    toast.success("Download started", { description: "CSV contains headline KPIs for the current scope." });
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live pipeline state, team performance, and funnel diagnostics."
        actions={
          <>
            <Select defaultValue="30d">
              <SelectTrigger size="sm" className="w-32">
                <Calendar className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="qtd">Quarter to date</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" type="button" onClick={openFilterDialog} className="gap-1.5">
              <Filter className="h-3.5 w-3.5" /> Filter
              {channelScope.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                  {channelScope.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={exportOverviewCsv}
              disabled={!isDemo && leads.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export
            </Button>
          </>
        }
      />

      <Dialog
        open={filterOpen}
        onOpenChange={(o) => {
          if (o) setDraftChannels(channelScope);
          setFilterOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Filter overview</DialogTitle>
            <DialogDescription>
              Limit KPIs, charts, and funnels to specific channels. Leave none selected to show everything.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 max-h-[50vh] overflow-y-auto pr-1">
            {CHANNEL_LIST.map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <Checkbox
                  id={`dash-ch-${c.key}`}
                  checked={draftChannels.includes(c.key)}
                  onCheckedChange={() => toggleDraft(c.key)}
                />
                <Label htmlFor={`dash-ch-${c.key}`} className="text-sm font-normal cursor-pointer leading-snug">
                  {c.label}
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftChannels([]);
                setChannelScope([]);
                setFilterOpen(false);
              }}
            >
              Clear all
            </Button>
            <Button type="button" onClick={applyChannelFilter}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageBody>
        {!isDemo && leads.length === 0 ? (
          <div className="py-8">
            <WorkspaceEmptyHint
              title="Your workspace is empty"
              description="Charts and scorecards need leads and deals. Use Demo mode to see how everything fits together, then switch back when your data is connected."
            />
          </div>
        ) : (
          <>
            {channelScope.length > 0 && (
              <p className="text-xs text-muted-foreground mb-2">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {channelScope.map((k) => CHANNEL_LIST.find((c) => c.key === k)?.label ?? k).join(", ")}
                </span>
                .{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setChannelScope([])}
                >
                  Reset
                </button>
              </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Open leads"
                value={totalOpen}
                hint="Across channels you can access"
                icon={Target}
              />
              <KpiCard
                label="Pipeline value"
                value={`$${(pipelineValue / 1000).toFixed(0)}k`}
                hint={`${scopedDeals.filter((d) => !["won", "lost"].includes(d.stage)).length} open deals`}
                icon={TrendingUp}
              />
              <KpiCard
                label="Closed (30d)"
                value={`$${(closedValue / 1000).toFixed(0)}k`}
                hint={`${scopedDeals.filter((d) => d.stage === "won").length} deals won`}
                icon={DollarSign}
              />
              <KpiCard
                label="Avg response"
                value={`${avgResponseMin.toFixed(0)}m`}
                hint="Time to first outbound"
                deltaType="positive-down"
                icon={Clock}
              />
              <KpiCard
                label="Idle leads"
                value={idleCount}
                hint="Over stage threshold"
                deltaType="positive-down"
                icon={Inbox}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="min-w-0 lg:col-span-2">
                <TrendChart
                  leads={scopedLeads}
                  deals={scopedDeals}
                  activityRecords={scopedActivityRecords}
                />
              </div>
              <PipelineDistribution leads={scopedLeads} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Channel funnels</h2>
                  <p className="text-xs text-muted-foreground">
                    Each channel&apos;s stage-by-stage conversion. Click any stage to drill into leads.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <FunnelChart channel="cold_email" title="Cold Email" counts={coldEmailCounts} />
                <FunnelChart channel="linkedin_outbound" title="LinkedIn Outbound" counts={linkedinCounts} />
                <FunnelChart channel="upwork" title="Upwork" counts={upworkCounts} />
                <FunnelChart channel="website_form" title="Website Form" counts={websiteCounts} />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 flex flex-col gap-4">
                <PersonScorecard leads={scopedLeads} deals={scopedDeals} />
                <ChannelMix leads={scopedLeads} />
              </div>
              <IdleLeads leads={scopedLeads} />
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
