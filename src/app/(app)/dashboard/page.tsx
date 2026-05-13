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
import { aggregateChannelFunnelCounts, computeOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import { downloadDashboardKpiCsv } from "@/lib/dashboard-csv";
import { CHANNEL_LIST, ROLES } from "@/lib/constants";
import { IDLE_LEAD_THRESHOLD_DAYS } from "@/lib/lead-idle";
import {
  getDashboardOverviewDescription,
  getDashboardRoleFocusLine,
  isFrontlineDashboardRole,
} from "@/lib/dashboard-role-focus";
import { DashboardPendingOverview } from "@/components/dashboard/dashboard-pending-overview";
import {
  OWNER_SCOPE_PREFIX,
  buildPersonOwnerOptions,
  filterActivityCountersByOwnerScope,
  filterActivityRecordsByOwnerScope,
  filterLeadsByOwnerScope,
  getOwnerFilterTriggerLabel,
} from "@/lib/owner-scope";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import type { ChannelKey } from "@/lib/types";
import { Target, Clock, DollarSign, TrendingUp, Inbox, Calendar, Download, Filter, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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

const DASHBOARD_RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
] as const;

export default function DashboardPage() {
  const {
    leads,
    deals,
    isDemo,
    activityCounters,
    activityRecords,
    users,
    currentUserId,
    getUserById,
    getOwnerDisplayName,
    leadTasks,
    followups,
    setFollowupCompleted,
    setLeadTaskCompleted,
  } = useWorkspace();
  const { localRollups } = useLocalActivityRollups();
  const activityCountersWithLocal = React.useMemo(
    () => mergeActivityCounters(activityCounters, localRollups),
    [activityCounters, localRollups],
  );
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [channelScope, setChannelScope] = React.useState<ChannelKey[]>([]);
  const [draftChannels, setDraftChannels] = React.useState<ChannelKey[]>([]);
  const [ownerScope, setOwnerScope] = React.useState("all-owners");
  const [timeRange, setTimeRange] = React.useState("30d");

  const ownerScopeDeps = React.useMemo(
    () => ({ currentUserId, users, getUserById, getOwnerDisplayName }),
    [currentUserId, users, getUserById, getOwnerDisplayName],
  );

  const personOwnerOptions = React.useMemo(
    () => buildPersonOwnerOptions(leads, users, getUserById, getOwnerDisplayName),
    [leads, users, getUserById, getOwnerDisplayName],
  );

  const ownerFilterTriggerLabel = React.useMemo(
    () => getOwnerFilterTriggerLabel(ownerScope, personOwnerOptions),
    [ownerScope, personOwnerOptions],
  );

  function openFilterDialog() {
    setDraftChannels(channelScope);
    setFilterOpen(true);
  }

  const channelScopedLeads = React.useMemo(
    () => (channelScope.length ? leads.filter((l) => channelScope.includes(l.channel)) : leads),
    [leads, channelScope],
  );

  const scopedLeads = React.useMemo(
    () => filterLeadsByOwnerScope(channelScopedLeads, ownerScope, ownerScopeDeps),
    [channelScopedLeads, ownerScope, ownerScopeDeps],
  );

  const scopedLeadIds = React.useMemo(() => new Set(scopedLeads.map((l) => l.id)), [scopedLeads]);

  const scopedDeals = React.useMemo(() => {
    if (channelScope.length === 0 && ownerScope === "all-owners") return deals;
    return deals.filter((d) => scopedLeadIds.has(d.leadId));
  }, [deals, scopedLeadIds, channelScope.length, ownerScope]);

  const activityAfterChannel = React.useMemo(
    () =>
      channelScope.length
        ? activityCountersWithLocal.filter((r) => channelScope.includes(r.channel))
        : activityCountersWithLocal,
    [activityCountersWithLocal, channelScope],
  );

  const scopedActivityCounters = React.useMemo(
    () => filterActivityCountersByOwnerScope(activityAfterChannel, ownerScope, ownerScopeDeps),
    [activityAfterChannel, ownerScope, ownerScopeDeps],
  );

  const activityRecordsAfterChannel = React.useMemo(
    () =>
      channelScope.length ? activityRecords.filter((r) => channelScope.includes(r.channel)) : activityRecords,
    [activityRecords, channelScope],
  );

  const scopedActivityRecords = React.useMemo(
    () => filterActivityRecordsByOwnerScope(activityRecordsAfterChannel, ownerScope, ownerScopeDeps),
    [activityRecordsAfterChannel, ownerScope, ownerScopeDeps],
  );

  const totalOpen = scopedLeads.filter((l) => !["won", "lost"].includes(l.stage)).length;
  const idleCount = scopedLeads.filter((l) => l.isIdle).length;
  const avgResponseMin =
    scopedLeads.filter((l) => l.responseTimeMinutes != null).reduce((s, l) => s + (l.responseTimeMinutes ?? 0), 0) /
    Math.max(1, scopedLeads.filter((l) => l.responseTimeMinutes != null).length);
  const pipelineMetrics = React.useMemo(
    () => computeOpenPipelineMetrics(scopedLeads, scopedDeals),
    [scopedLeads, scopedDeals],
  );
  const pipelineValue = pipelineMetrics.total;
  const closedValue = scopedDeals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);

  const viewer = React.useMemo(
    () => (currentUserId ? getUserById(currentUserId) : undefined),
    [currentUserId, getUserById],
  );
  const frontlineLayout = isFrontlineDashboardRole(viewer?.roleId);

  const pipelineHint = React.useMemo(() => {
    const parts = [`${pipelineMetrics.openDealCount} open deal${pipelineMetrics.openDealCount === 1 ? "" : "s"}`];
    if (pipelineMetrics.leadEstimateContributors > 0) {
      parts.push(
        `${pipelineMetrics.leadEstimateContributors} lead estimate${pipelineMetrics.leadEstimateContributors === 1 ? "" : "s"}`,
      );
    }
    return parts.join(" · ");
  }, [pipelineMetrics.leadEstimateContributors, pipelineMetrics.openDealCount]);

  const funnelChannelKeys = React.useMemo(() => {
    if (channelScope.length === 0) return CHANNEL_LIST.map((c) => c.key);
    const order = new Map(CHANNEL_LIST.map((c, i) => [c.key, i]));
    return [...channelScope].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }, [channelScope]);

  const funnelCharts = React.useMemo(
    () =>
      funnelChannelKeys.map((key) => {
        const meta = CHANNEL_LIST.find((c) => c.key === key);
        return {
          channel: key,
          title: meta?.label ?? key,
          counts: aggregateChannelFunnelCounts(key, scopedActivityCounters, scopedLeads, scopedDeals),
        };
      }),
    [funnelChannelKeys, scopedActivityCounters, scopedLeads, scopedDeals],
  );

  const pendingOverview = (
    <DashboardPendingOverview
      roleId={viewer?.roleId}
      followups={followups}
      leadTasks={leadTasks}
      currentUserId={currentUserId}
      setFollowupCompleted={setFollowupCompleted}
      setLeadTaskCompleted={setLeadTaskCompleted}
    />
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
    const ch =
      channelScope.length === 0
        ? "all channels"
        : channelScope.map((c) => CHANNEL_LIST.find((x) => x.key === c)?.label ?? c).join("; ");
    const own = ownerFilterTriggerLabel;
    const scope = `${ch} · ${own}`;
    downloadDashboardKpiCsv(
      [
        { label: "Scope", value: scope },
        { label: "Open leads", value: String(totalOpen) },
        { label: "Pipeline value (USD)", value: String(Math.round(pipelineValue)) },
        { label: "Closed revenue (USD)", value: String(Math.round(closedValue)) },
        {
          label: "Open deals",
          value: String(pipelineMetrics.openDealCount),
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
        description={getDashboardOverviewDescription(viewer?.roleId)}
        actions={
          <>
            <Select
              value={timeRange}
              onValueChange={(v) => {
                if (!v || v === timeRange) return;
                setTimeRange(v);
              }}
            >
              <SelectTrigger size="sm" className="w-32">
                <Calendar className="h-3.5 w-3.5 mr-1" />
                <SelectValue>
                  {selectTriggerLabelByKey(timeRange, DASHBOARD_RANGE_OPTIONS) ?? undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="qtd">Quarter to date</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={ownerScope}
              onValueChange={(v) => {
                const next = v ?? "all-owners";
                if (next === ownerScope) return;
                setOwnerScope(next);
              }}
            >
              <SelectTrigger size="sm" className="min-w-[9.5rem] max-w-[13rem] gap-1.5">
                <Users className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                <SelectValue placeholder="Owner">
                  {ownerFilterTriggerLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wide">Quick</SelectLabel>
                  <SelectItem value="all-owners">All owners</SelectItem>
                  <SelectItem value="me">Owned by me</SelectItem>
                  <SelectItem value="team">My team</SelectItem>
                  <SelectItem value="open-queue">Open queue</SelectItem>
                  <SelectItem value="unassigned">Orphan owner</SelectItem>
                </SelectGroup>
                {personOwnerOptions.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wide">By teammate</SelectLabel>
                      {personOwnerOptions.map((o) => (
                        <SelectItem key={o.id} value={`${OWNER_SCOPE_PREFIX}${o.id}`}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
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
                setOwnerScope("all-owners");
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
            {viewer && (
              <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3">
                <p className="text-xs font-semibold text-foreground">
                  {ROLES[viewer.roleId]?.label ?? "Member"} view
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {getDashboardRoleFocusLine(viewer.roleId)}
                </p>
              </div>
            )}
            {frontlineLayout && pendingOverview}
            {(channelScope.length > 0 || ownerScope !== "all-owners") && (
              <p className="text-xs text-muted-foreground mb-2">
                {channelScope.length > 0 && (
                  <>
                    Channels:{" "}
                    <span className="font-medium text-foreground">
                      {channelScope.map((k) => CHANNEL_LIST.find((c) => c.key === k)?.label ?? k).join(", ")}
                    </span>
                    .{" "}
                  </>
                )}
                {ownerScope !== "all-owners" && (
                  <>
                    Owner: <span className="font-medium text-foreground">{ownerFilterTriggerLabel}</span>.{" "}
                  </>
                )}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setChannelScope([]);
                    setOwnerScope("all-owners");
                  }}
                >
                  Reset filters
                </button>
              </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Open leads"
                value={totalOpen}
                hint="Across channels you can access"
                icon={Target}
                href="/leads"
              />
              <KpiCard
                label="Pipeline value"
                value={`$${(pipelineValue / 1000).toFixed(0)}k`}
                hint={pipelineHint}
                icon={TrendingUp}
                href="/deals"
              />
              <KpiCard
                label="Closed (30d)"
                value={`$${(closedValue / 1000).toFixed(0)}k`}
                hint={`${scopedDeals.filter((d) => d.stage === "won").length} deals won`}
                icon={DollarSign}
                href="/deals"
              />
              <KpiCard
                label="Avg response"
                value={`${avgResponseMin.toFixed(0)}m`}
                hint="Time to first outbound"
                deltaType="positive-down"
                icon={Clock}
                href="/activity"
              />
              <KpiCard
                label="Idle leads"
                value={idleCount}
                hint={`No activity in ${IDLE_LEAD_THRESHOLD_DAYS}+ days (excl. won/lost)`}
                deltaType="positive-down"
                icon={Inbox}
                href="/leads?filter=idle"
              />
            </div>

            {!frontlineLayout && pendingOverview}

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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {funnelCharts.map(({ channel, title, counts }) => (
                  <FunnelChart key={channel} channel={channel} title={title} counts={counts} />
                ))}
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
