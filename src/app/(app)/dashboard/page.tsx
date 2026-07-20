"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/common/kpi-card";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { PipelineDistribution } from "@/components/dashboard/pipeline-distribution";
import { PersonScorecard } from "@/components/dashboard/person-scorecard";
import { IdleLeads } from "@/components/dashboard/idle-leads";
import { ChannelMix } from "@/components/dashboard/channel-mix";
import { OwnerOpsBoard } from "@/components/dashboard/owner-ops-board";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useLocalActivityRollups } from "@/hooks/use-local-activity-rollups";
import { mergeActivityCounters } from "@/lib/activity-local-rollups";
import { aggregateChannelFunnelCounts, computeOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import { downloadDashboardKpiCsv } from "@/lib/dashboard-csv";
import { CHANNEL_LIST, ROLES, roleLabel } from "@/lib/constants";
import { useEnabledBuiltinChannelKeys } from "@/hooks/use-channel-options";
import {
  getDashboardOverviewDescription,
  getDashboardRoleFocusLine,
  showTeamFollowupsOnDashboard,
} from "@/lib/dashboard-role-focus";
import { showOwnerOpsDashboard } from "@/lib/dashboard-ops-analytics";
import {
  resolveEffectiveDashboardRole,
  resolveFrontlineLayout,
  resolveOpsLayout,
} from "@/lib/dashboard-preferences";
import { roleAtLeast } from "@/lib/platform/org-role";
import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { DashboardReplyReviews } from "@/components/dashboard/dashboard-reply-reviews";
import { ChannelFunnelsSettings } from "@/components/dashboard/channel-funnels-settings";
import { DashboardSettingsSheet } from "@/components/dashboard/dashboard-settings-sheet";
import { DashboardAiBrief } from "@/components/ai/dashboard-ai-brief";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import {
  computeAverageResponseTimeMinutes,
  resolveLeadResponseTimeMinutes,
  responseTimeModeForOwnerScope,
} from "@/lib/email/lead-response-time";
import {
  filterLeadsByDateRange,
  filterDealsByDateRange,
  filterActivityRecordsByDateRange,
  filterActivityCountersByDateRange,
  type DashboardTimeRangeKey,
  DASHBOARD_TIME_RANGE_LABELS,
} from "@/lib/dashboard-date-range";
import {
  OWNER_SCOPE_PREFIX,
  buildPersonOwnerOptions,
  filterActivityCountersByOwnerScope,
  filterActivityRecordsByOwnerScope,
  filterLeadsByOwnerScope,
  getOwnerFilterTriggerLabel,
} from "@/lib/owner-scope";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import type { ChannelKey, OrgMemberRole } from "@/lib/types";
import {
  Target,
  Clock,
  DollarSign,
  TrendingUp,
  Calendar,
  Download,
  Filter,
  Users,
  UserRoundSearch,
  CalendarClock,
  Workflow,
  ListTodo,
  Send,
  Megaphone,
  MessageSquareReply,
  CircleCheck,
  Eye,
  Monitor,
} from "lucide-react";
import { computeDashboardWorkflowMetrics, isSalesLead } from "@/lib/dashboard-workflow";
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

const TrendChart = dynamic(
  () => import("@/components/dashboard/trend-chart").then((m) => ({ default: m.TrendChart })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] animate-pulse rounded-lg border bg-muted/20" aria-hidden />
    ),
  },
);

const DASHBOARD_RANGE_OPTIONS = (
  Object.entries(DASHBOARD_TIME_RANGE_LABELS) as [DashboardTimeRangeKey, string][]
).map(([key, label]) => ({ key, label }));

export default function DashboardPage() {
  const {
    leads,
    deals,
    isDemo,
    workspaceLoading,
    users,
    activityCounters,
    activityRecords,
    campaigns,
    currentUserId,
    getUserById,
    getOwnerDisplayName,
    leadTasks,
    followups,
    followupPlans,
    timelineByLead,
    orgActivityEvents,
    viewerOrgRole,
  } = useWorkspace();
  const enabledBuiltinChannels = useEnabledBuiltinChannelKeys();
  const emailResponseCtx = useLeadEmailResponseContext();
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

  const ownerScopedLeads = React.useMemo(
    () => filterLeadsByOwnerScope(channelScopedLeads, ownerScope, ownerScopeDeps),
    [channelScopedLeads, ownerScope, ownerScopeDeps],
  );

  const scopedLeads = React.useMemo(
    () => filterLeadsByDateRange(ownerScopedLeads, timeRange as DashboardTimeRangeKey),
    [ownerScopedLeads, timeRange],
  );

  const scopedLeadIds = React.useMemo(() => new Set(scopedLeads.map((l) => l.id)), [scopedLeads]);
  const scopedSalesLeads = React.useMemo(() => scopedLeads.filter(isSalesLead), [scopedLeads]);
  const scopedProspects = React.useMemo(
    () => scopedLeads.filter((lead) => lead.intakeKind === "prospect"),
    [scopedLeads],
  );

  const ownerScopedDeals = React.useMemo(() => {
    if (channelScope.length === 0 && ownerScope === "all-owners") return deals;
    const ids = new Set(
      filterLeadsByOwnerScope(channelScopedLeads.filter(isSalesLead), ownerScope, ownerScopeDeps).map((l) => l.id),
    );
    return deals.filter((d) => ids.has(d.leadId));
  }, [deals, channelScopedLeads, ownerScope, ownerScopeDeps, channelScope.length]);

  const scopedDeals = React.useMemo(
    () => filterDealsByDateRange(ownerScopedDeals, timeRange as DashboardTimeRangeKey),
    [ownerScopedDeals, timeRange],
  );

  const activityAfterChannel = React.useMemo(
    () =>
      channelScope.length
        ? activityCountersWithLocal.filter((r) => channelScope.includes(r.channel))
        : activityCountersWithLocal,
    [activityCountersWithLocal, channelScope],
  );

  const scopedActivityCounters = React.useMemo(
    () =>
      filterActivityCountersByOwnerScope(
        filterActivityCountersByDateRange(activityAfterChannel, timeRange as DashboardTimeRangeKey),
        ownerScope,
        ownerScopeDeps,
      ),
    [activityAfterChannel, ownerScope, ownerScopeDeps, timeRange],
  );

  const activityRecordsAfterChannel = React.useMemo(
    () =>
      channelScope.length ? activityRecords.filter((r) => channelScope.includes(r.channel)) : activityRecords,
    [activityRecords, channelScope],
  );

  const scopedActivityRecords = React.useMemo(
    () =>
      filterActivityRecordsByOwnerScope(
        filterActivityRecordsByDateRange(activityRecordsAfterChannel, timeRange as DashboardTimeRangeKey),
        ownerScope,
        ownerScopeDeps,
      ),
    [activityRecordsAfterChannel, ownerScope, ownerScopeDeps, timeRange],
  );

  const workflowFollowups = React.useMemo(
    () => followups.filter((followup) => !followup.leadId || scopedLeadIds.has(followup.leadId)),
    [followups, scopedLeadIds],
  );
  const workflowPlans = React.useMemo(
    () => followupPlans.filter((plan) => scopedLeadIds.has(plan.leadId)),
    [followupPlans, scopedLeadIds],
  );
  const workflowTasks = React.useMemo(
    () => leadTasks.filter((task) => !task.leadId || scopedLeadIds.has(task.leadId)),
    [leadTasks, scopedLeadIds],
  );
  const workflowMetrics = React.useMemo(
    () =>
      computeDashboardWorkflowMetrics({
        leads: scopedLeads,
        followups: workflowFollowups,
        plans: workflowPlans,
        tasks: workflowTasks,
        currentUserId,
        range: timeRange as DashboardTimeRangeKey,
      }),
    [
      scopedLeads,
      workflowFollowups,
      workflowPlans,
      workflowTasks,
      currentUserId,
      timeRange,
    ],
  );
  const avgResponseMin = React.useMemo(
    () =>
      computeAverageResponseTimeMinutes(scopedSalesLeads, emailResponseCtx, {
        ownerScope,
        currentUserId,
      }),
    [scopedSalesLeads, emailResponseCtx, ownerScope, currentUserId],
  );

  const demoLeadsForBrief = React.useMemo(() => {
    if (!isDemo) return undefined;
    const mode = responseTimeModeForOwnerScope(ownerScope, currentUserId);
    return leads.filter(isSalesLead).map((l) => {
      const minutes = resolveLeadResponseTimeMinutes(l, emailResponseCtx, {
        mode,
        currentUserId,
      });
      return minutes != null ? { ...l, responseTimeMinutes: minutes } : l;
    });
  }, [isDemo, leads, emailResponseCtx, ownerScope, currentUserId]);
  const pipelineMetrics = React.useMemo(
    () => computeOpenPipelineMetrics(scopedSalesLeads, scopedDeals),
    [scopedSalesLeads, scopedDeals],
  );
  const pipelineValue = pipelineMetrics.total;
  const closedValue = scopedDeals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);

  const viewer = React.useMemo(
    () => (currentUserId ? getUserById(currentUserId) : undefined),
    [currentUserId, getUserById],
  );
  const canCustomizeLayout = showOwnerOpsDashboard(viewer, viewerOrgRole);
  const {
    prefs,
    setViewMode,
    setPreviewRole,
    setWidget,
    setAllWidgets,
    setChannelFunnelVisible,
    setAllChannelFunnelsVisible,
    reset,
  } = useDashboardPreferences(currentUserId || "anon");

  const effectiveRole = resolveEffectiveDashboardRole(viewer?.roleId, prefs);
  const frontlineLayout = resolveFrontlineLayout(effectiveRole, prefs);
  const opsLayout = resolveOpsLayout(canCustomizeLayout, effectiveRole, prefs);
  const orgRole = (viewerOrgRole ?? viewer?.orgRole) as OrgMemberRole | undefined;
  const orgMeetingsScope = orgRole ? roleAtLeast(orgRole, "manager") : false;
  const w = prefs.widgets;

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
    const enabledSet = new Set(enabledBuiltinChannels);
    const base =
      channelScope.length === 0
        ? enabledBuiltinChannels
        : channelScope.filter((k) => enabledSet.has(k));
    const order = new Map(CHANNEL_LIST.map((c, i) => [c.key, i]));
    return [...base].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }, [channelScope, enabledBuiltinChannels]);

  const funnelCharts = React.useMemo(
    () =>
      funnelChannelKeys
        .filter((key) => prefs.channelFunnelsVisible[key] !== false)
        .map((key) => {
          const meta = CHANNEL_LIST.find((c) => c.key === key);
          return {
            channel: key,
            title: meta?.label ?? key,
            counts: aggregateChannelFunnelCounts(key, scopedActivityCounters, scopedSalesLeads, scopedDeals),
          };
        }),
    [
      funnelChannelKeys,
      prefs.channelFunnelsVisible,
      scopedActivityCounters,
      scopedSalesLeads,
      scopedDeals,
    ],
  );

  const outreachMetrics = React.useMemo(
    () =>
      campaigns.reduce(
        (totals, campaign) => ({
          active: totals.active + (campaign.status === "active" ? 1 : 0),
          sent: totals.sent + campaign.stats.sent,
          replied: totals.replied + campaign.stats.replied,
          completed: totals.completed + (campaign.stats.completed ?? 0),
        }),
        { active: 0, sent: 0, replied: 0, completed: 0 },
      ),
    [campaigns],
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
        { label: "Open sales leads", value: String(workflowMetrics.openSalesLeads) },
        { label: "Prospects", value: String(workflowMetrics.prospects) },
        { label: "Follow-ups due", value: String(workflowMetrics.followupsDue) },
        { label: "Active sequences", value: String(workflowMetrics.activeSequences) },
        { label: "Sequence steps remaining", value: String(workflowMetrics.remainingSequenceSteps) },
        { label: "Sequences paused on reply", value: String(workflowMetrics.pausedOnReply) },
        { label: "Total replies", value: String(workflowMetrics.totalReplies) },
        { label: "Replies in range", value: String(workflowMetrics.repliesInRange) },
        { label: "Replies pending review", value: String(workflowMetrics.repliesPendingReview) },
        { label: "Emails sent in range", value: String(workflowMetrics.sentInRange) },
        { label: "Emails scheduled", value: String(workflowMetrics.scheduledSteps) },
        { label: "Email failures", value: String(workflowMetrics.failedDeliveries) },
        { label: "My open tasks", value: String(workflowMetrics.myOpenTasks) },
        { label: "Pipeline value (USD)", value: String(Math.round(pipelineValue)) },
        { label: "Closed revenue (USD)", value: String(Math.round(closedValue)) },
        {
          label: "Open deals",
          value: String(pipelineMetrics.openDealCount),
        },
        { label: "Won deals", value: String(scopedDeals.filter((d) => d.stage === "won").length) },
        { label: "Idle leads", value: String(workflowMetrics.idleSalesLeads) },
        {
          label: "Avg response (minutes)",
          value: avgResponseMin != null ? String(Math.round(avgResponseMin)) : "-",
        },
      ],
      "nova-dashboard-overview",
    );
    toast.success("Download started", { description: "CSV contains headline KPIs for the current scope." });
  }

  return (
    <>
      <PageHeader
        title="Overview"
        description={getDashboardOverviewDescription(effectiveRole ?? viewer?.roleId)}
        actions={
          <>
            {canCustomizeLayout ? (
              <Link
                href="/dashboard/wall"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                <Monitor className="h-3.5 w-3.5" />
                Wall mode
              </Link>
            ) : null}
            {canCustomizeLayout ? (
              <DashboardSettingsSheet
                prefs={prefs}
                canCustomize={canCustomizeLayout}
                onViewModeChange={setViewMode}
                onPreviewRoleChange={setPreviewRole}
                onWidgetChange={setWidget}
                onEnableAll={() => setAllWidgets(true)}
                onDisableAll={() => setAllWidgets(false)}
                onReset={reset}
              />
            ) : null}
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
                {(Object.entries(DASHBOARD_TIME_RANGE_LABELS) as [DashboardTimeRangeKey, string][]).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
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
              <SelectTrigger size="sm" className="min-w-38 max-w-52 gap-1.5">
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
            {CHANNEL_LIST.filter((c) => enabledBuiltinChannels.includes(c.key)).map((c) => (
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
        {workspaceLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && leads.length === 0 ? (
          <div className="py-8">
            <WorkspaceEmptyHint
              title="Your workspace is empty"
              description="Charts and scorecards need leads and deals. Use Demo mode to see how everything fits together, then switch back when your data is connected."
            />
          </div>
        ) : (
          <>
            {(prefs.previewRole || prefs.viewMode !== "auto") && canCustomizeLayout && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-2.5 text-xs">
                <Eye className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground">
                  {prefs.previewRole
                    ? `Previewing as ${roleLabel(prefs.previewRole)}`
                    : `View: ${prefs.viewMode === "ops" ? "Owner command board" : prefs.viewMode === "classic" ? "Pipeline classic" : "Employee board"}`}
                </span>
                <span className="text-muted-foreground">Layout only — data access is unchanged.</span>
                <button
                  type="button"
                  className="ml-auto text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setPreviewRole(null);
                    setViewMode("auto");
                  }}
                >
                  Exit preview
                </button>
              </div>
            )}
            {viewer && (
              <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3">
                <p className="text-xs font-semibold text-foreground">
                  {roleLabel(effectiveRole ?? viewer.roleId)} view
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {getDashboardRoleFocusLine(effectiveRole ?? viewer.roleId)}
                </p>
              </div>
            )}
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

            {opsLayout ? (
              <OwnerOpsBoard
                metrics={workflowMetrics}
                leads={scopedLeads}
                deals={scopedDeals}
                followups={workflowFollowups}
                plans={workflowPlans}
                tasks={workflowTasks}
                users={users}
                timelineByLead={timelineByLead}
                orgActivityEvents={orgActivityEvents}
                activityRecords={activityRecords}
                range={timeRange as DashboardTimeRangeKey}
                teamCommandLeads={ownerScopedLeads}
                teamCommandDeals={ownerScopedDeals}
                teamCommandFollowups={followups}
                currentUserId={currentUserId}
                orgMeetingsScope={orgMeetingsScope}
                widgets={w}
                isDemo={isDemo}
              />
            ) : w.classicKpis ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-4">
                  <KpiCard
                    label="Open sales leads"
                    value={workflowMetrics.openSalesLeads}
                    hint={`${workflowMetrics.idleSalesLeads} idle`}
                    icon={Target}
                    href="/leads"
                  />
                  <KpiCard
                    label="Prospects"
                    value={scopedProspects.length}
                    hint={`${workflowMetrics.prospectsNeedRouting} need routing · ${workflowMetrics.prospectsPushed} pushed`}
                    icon={UserRoundSearch}
                    href="/prospects"
                  />
                  <KpiCard
                    label="Total replies"
                    value={workflowMetrics.totalReplies}
                    hint={`${workflowMetrics.repliesInRange} in ${DASHBOARD_TIME_RANGE_LABELS[timeRange as DashboardTimeRangeKey].toLowerCase()} · ${workflowMetrics.repliesPendingReview} to review`}
                    icon={MessageSquareReply}
                    href="/leads?stage=replied"
                  />
                  <KpiCard
                    label="Follow-ups due"
                    value={workflowMetrics.followupsDue}
                    hint={`${workflowMetrics.overdueFollowups} overdue · ${workflowMetrics.scheduledSteps} scheduled`}
                    icon={CalendarClock}
                    href="/followups"
                  />
                  <KpiCard
                    label="Active sequences"
                    value={workflowMetrics.activeSequences}
                    hint={`${workflowMetrics.remainingSequenceSteps} steps remaining · ${workflowMetrics.pausedOnReply} stopped on reply`}
                    icon={Workflow}
                    href="/followups"
                  />
                  <KpiCard
                    label="Tasks"
                    value={workflowMetrics.myOpenTasks}
                    hint={`${workflowMetrics.overdueTasks} overdue · ${workflowMetrics.waitingOnOthers} waiting on others`}
                    icon={ListTodo}
                    href="/tasks"
                  />
                  <KpiCard
                    label="Email delivery"
                    value={workflowMetrics.sentInRange}
                    hint={`${workflowMetrics.scheduledSteps} scheduled · ${workflowMetrics.failedDeliveries} failed`}
                    icon={Send}
                    href="/inbox?folder=scheduled"
                  />
                </div>

                {w.pipelineKpis ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <KpiCard
                      label="Pipeline value"
                      value={`$${(pipelineValue / 1000).toFixed(0)}k`}
                      hint={pipelineHint}
                      icon={TrendingUp}
                      href="/deals"
                    />
                    <KpiCard
                      label={`Closed (${DASHBOARD_TIME_RANGE_LABELS[timeRange as DashboardTimeRangeKey]})`}
                      value={`$${(closedValue / 1000).toFixed(0)}k`}
                      hint={`${scopedDeals.filter((d) => d.stage === "won").length} deals won`}
                      icon={DollarSign}
                      href="/deals"
                    />
                    <KpiCard
                      label="Avg response"
                      value={avgResponseMin != null ? `${avgResponseMin.toFixed(0)}m` : "-"}
                      hint="Sales lead created → first outbound email"
                      deltaType="positive-down"
                      icon={Clock}
                      href="/activity"
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {w.replyReviews ? <DashboardReplyReviews leads={scopedLeads} /> : null}

            {!opsLayout && w.needsAttention ? (
              <DashboardNeedsAttention
                leads={scopedLeads}
                followups={workflowFollowups}
                plans={workflowPlans}
                tasks={workflowTasks}
                currentUserId={currentUserId}
              />
            ) : null}

            {!frontlineLayout && w.aiBrief ? (
              <DashboardAiBrief
                channelScope={channelScope}
                ownerScope={ownerScope}
                timeRange={timeRange as DashboardTimeRangeKey}
                ownerLabel={ownerFilterTriggerLabel}
                enabled={
                  Boolean(effectiveRole) &&
                  (showTeamFollowupsOnDashboard(effectiveRole) || effectiveRole === "director")
                }
                demoBundle={
                  isDemo
                    ? {
                        leads: demoLeadsForBrief ?? leads,
                        deals,
                        followups: workflowFollowups,
                        leadTasks: workflowTasks,
                        users,
                      }
                    : undefined
                }
              />
            ) : null}

            {!opsLayout && w.trendChart ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="min-w-0 lg:col-span-2">
                  <TrendChart
                    leads={scopedSalesLeads}
                    deals={scopedDeals}
                    activityRecords={scopedActivityRecords}
                  />
                </div>
                {w.pipelineDistribution ? <PipelineDistribution leads={scopedSalesLeads} /> : null}
              </div>
            ) : null}

            {opsLayout && w.pipelineKpis ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <KpiCard
                      label="Pipeline value"
                      value={`$${(pipelineValue / 1000).toFixed(0)}k`}
                      hint={pipelineHint}
                      icon={TrendingUp}
                      href="/deals"
                    />
                    <KpiCard
                      label={`Closed (${DASHBOARD_TIME_RANGE_LABELS[timeRange as DashboardTimeRangeKey]})`}
                      value={`$${(closedValue / 1000).toFixed(0)}k`}
                      hint={`${scopedDeals.filter((d) => d.stage === "won").length} deals won`}
                      icon={DollarSign}
                      href="/deals"
                    />
                  </div>
                </div>
                <KpiCard
                  label="Avg response"
                  value={avgResponseMin != null ? `${avgResponseMin.toFixed(0)}m` : "-"}
                  hint="Sales lead created → first outbound email"
                  deltaType="positive-down"
                  icon={Clock}
                  href="/activity"
                />
              </div>
            ) : null}

            {w.channelFunnels ? (
              <div>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Channel funnels</h2>
                    <p className="text-xs text-muted-foreground">
                      Each channel&apos;s stage-by-stage conversion. Click any stage to drill into leads.
                    </p>
                  </div>
                  <ChannelFunnelsSettings
                    visible={prefs.channelFunnelsVisible}
                    onChange={setChannelFunnelVisible}
                    onShowAll={() => setAllChannelFunnelsVisible(true)}
                    onHideAll={() => setAllChannelFunnelsVisible(false)}
                  />
                </div>
                {funnelCharts.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {funnelCharts.map(({ channel, title, counts }) => (
                      <FunnelChart key={channel} channel={channel} title={title} counts={counts} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
                    No channels visible. Use the settings control to turn funnels back on.
                  </p>
                )}
              </div>
            ) : null}

            {(w.scorecard && !opsLayout) ||
            (w.pipelineDistribution && opsLayout) ||
            w.channelMix ||
            w.idleLeads ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="flex flex-col gap-4 xl:col-span-2">
                  {!opsLayout && w.scorecard ? (
                    <PersonScorecard
                      leads={scopedSalesLeads}
                      deals={scopedDeals}
                      followups={workflowFollowups}
                      tasks={workflowTasks}
                      range={timeRange as DashboardTimeRangeKey}
                    />
                  ) : null}
                  {opsLayout && w.pipelineDistribution ? (
                    <PipelineDistribution leads={scopedSalesLeads} />
                  ) : null}
                  {w.channelMix ? <ChannelMix leads={scopedSalesLeads} /> : null}
                </div>
                {w.idleLeads ? <IdleLeads leads={scopedSalesLeads} /> : null}
              </div>
            ) : null}

            {campaigns.length > 0 && w.campaigns ? (
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Outreach campaigns</h2>
                  <p className="text-xs text-muted-foreground">
                    External campaign delivery is reported separately from CRM follow-up sequences.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <KpiCard label="Active campaigns" value={outreachMetrics.active} icon={Megaphone} href="/outreach" />
                  <KpiCard label="Campaign sent" value={outreachMetrics.sent} icon={Send} href="/outreach" />
                  <KpiCard
                    label="Campaign replies"
                    value={outreachMetrics.replied}
                    icon={MessageSquareReply}
                    href="/outreach"
                  />
                  <KpiCard
                    label="Campaign completed"
                    value={outreachMetrics.completed}
                    icon={CircleCheck}
                    href="/outreach"
                  />
                </div>
              </section>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
