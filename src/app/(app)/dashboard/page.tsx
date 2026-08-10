"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { FrontlineBoard } from "@/components/dashboard/frontline-board";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { aggregateChannelFunnelCounts, computeOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import {
  applyOrgDashboardSummaryToWorkflowMetrics,
  summaryClosedRevenue,
} from "@/lib/dashboard-summary-apply";
import { downloadDashboardKpiCsv } from "@/lib/dashboard-csv";
import { CHANNEL_LIST, roleLabel } from "@/lib/constants";
import { useEnabledBuiltinChannelKeys } from "@/hooks/use-channel-options";
import {
  getDashboardOverviewDescription,
  getDashboardRoleFocusLine,
  isContentOpsDashboardRole,
  showTeamFollowupsOnDashboard,
} from "@/lib/dashboard-role-focus";
import { showOwnerOpsDashboard } from "@/lib/dashboard-ops-analytics";
import {
  resolveContentLayout,
  resolveEffectiveDashboardRole,
  resolveFrontlineLayout,
  resolveOpsLayout,
} from "@/lib/dashboard-preferences";
import { can, canAction } from "@/lib/permissions/can";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { roleAtLeast } from "@/lib/platform/org-role";
import { DashboardNeedsAttentionWithContent } from "@/components/dashboard/dashboard-needs-attention-with-content";
import { ContentOpsBoard } from "@/components/dashboard/content-ops-board";
import { MyContentPlate } from "@/components/dashboard/my-content-plate";
import { CaptureDutyBanner } from "@/components/content/capture-duty-banner";
import { DashboardReplyReviews } from "@/components/dashboard/dashboard-reply-reviews";
import { ChannelFunnelsSettings } from "@/components/dashboard/channel-funnels-settings";
import { DashboardSettingsSheet } from "@/components/dashboard/dashboard-settings-sheet";
import { DashboardAiBrief } from "@/components/ai/dashboard-ai-brief";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import type { KpiTone } from "@/components/common/kpi-card";
import {
  computeAverageResponseTimeMinutes,
  resolveLeadResponseTimeMinutes,
  responseTimeModeForOwnerScope,
} from "@/lib/email/lead-response-time";
import {
  filterLeadsByDateRange,
  filterDealsByDateRange,
  filterActivityRecordsByDateRange,
  type DashboardTimeRangeKey,
  DASHBOARD_TIME_RANGE_LABELS,
  buildDashboardHref,
  buildDashboardWallHref,
  buildRepliesDrillHref,
  parseDashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import {
  OWNER_SCOPE_PREFIX,
  buildPersonOwnerOptions,
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
import { useOrgDashboardSummary } from "@/hooks/use-org-dashboard-summary";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const rangeFromUrl = parseDashboardTimeRangeKey(searchParams.get("range"), "30d");
  const {
    leads,
    deals,
    isDemo,
    workspaceLoading,
    users,
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
    contacts,
    organizationTimezone,
    activeOrgMemberIds,
  } = useWorkspace();
  const navAccess = useNavAccessContext();
  const enabledBuiltinChannels = useEnabledBuiltinChannelKeys();
  const emailResponseCtx = useLeadEmailResponseContext();
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [channelScope, setChannelScope] = React.useState<ChannelKey[]>([]);
  const [draftChannels, setDraftChannels] = React.useState<ChannelKey[]>([]);
  const [ownerScope, setOwnerScope] = React.useState("all-owners");
  const [timeRange, setTimeRange] = React.useState(rangeFromUrl);

  React.useEffect(() => {
    setTimeRange(rangeFromUrl);
  }, [rangeFromUrl]);

  const ownerScopeDeps = React.useMemo(
    () => ({ currentUserId, users, getUserById, getOwnerDisplayName }),
    [currentUserId, users, getUserById, getOwnerDisplayName],
  );

  const personOwnerOptions = React.useMemo(
    () =>
      buildPersonOwnerOptions(leads, users, getUserById, getOwnerDisplayName, {
        activeMemberIds: activeOrgMemberIds ?? undefined,
      }),
    [leads, users, getUserById, getOwnerDisplayName, activeOrgMemberIds],
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
    () =>
      filterLeadsByDateRange(ownerScopedLeads, timeRange as DashboardTimeRangeKey, {
        timeZone: organizationTimezone,
      }),
    [ownerScopedLeads, timeRange, organizationTimezone],
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
    () =>
      filterDealsByDateRange(ownerScopedDeals, timeRange as DashboardTimeRangeKey, {
        timeZone: organizationTimezone,
      }),
    [ownerScopedDeals, timeRange, organizationTimezone],
  );

  const activityRecordsAfterChannel = React.useMemo(
    () =>
      channelScope.length ? activityRecords.filter((r) => channelScope.includes(r.channel)) : activityRecords,
    [activityRecords, channelScope],
  );

  const scopedActivityRecords = React.useMemo(
    () =>
      filterActivityRecordsByOwnerScope(
        filterActivityRecordsByDateRange(
          activityRecordsAfterChannel,
          timeRange as DashboardTimeRangeKey,
          { timeZone: organizationTimezone },
        ),
        ownerScope,
        ownerScopeDeps,
      ),
    [activityRecordsAfterChannel, ownerScope, ownerScopeDeps, timeRange, organizationTimezone],
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
        contacts,
        currentUserId,
        range: timeRange as DashboardTimeRangeKey,
        timeZone: organizationTimezone,
      }),
    [
      scopedLeads,
      workflowFollowups,
      workflowPlans,
      workflowTasks,
      contacts,
      currentUserId,
      timeRange,
      organizationTimezone,
    ],
  );

  /** Org-wide summary only (P0.6) — filtered views stay on live aggregation. */
  const orgWideDashboardScope = channelScope.length === 0 && ownerScope === "all-owners";
  const dashboardSummary = useOrgDashboardSummary({
    enabled: !isDemo && !workspaceLoading,
    orgWideScope: orgWideDashboardScope,
  });
  const displayMetrics = React.useMemo(() => {
    const summary = dashboardSummary.summary;
    if (!dashboardSummary.enabled || !summary || !orgWideDashboardScope) {
      return workflowMetrics;
    }
    return applyOrgDashboardSummaryToWorkflowMetrics(
      workflowMetrics,
      summary,
      timeRange,
      dashboardSummary.person,
    );
  }, [
    workflowMetrics,
    dashboardSummary.enabled,
    dashboardSummary.summary,
    dashboardSummary.person,
    orgWideDashboardScope,
    timeRange,
  ]);
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
  const displayPipelineMetrics = React.useMemo(() => {
    const summary = dashboardSummary.summary;
    if (!dashboardSummary.enabled || !summary || !orgWideDashboardScope) {
      return pipelineMetrics;
    }
    return {
      total:
        typeof summary.openPipelineValue === "number" && Number.isFinite(summary.openPipelineValue)
          ? Math.max(0, summary.openPipelineValue)
          : pipelineMetrics.total,
      openDealCount:
        typeof summary.openDealCount === "number" && Number.isFinite(summary.openDealCount)
          ? Math.max(0, summary.openDealCount)
          : pipelineMetrics.openDealCount,
      leadEstimateContributors:
        typeof summary.leadEstimateContributors === "number" &&
        Number.isFinite(summary.leadEstimateContributors)
          ? Math.max(0, summary.leadEstimateContributors)
          : pipelineMetrics.leadEstimateContributors,
    };
  }, [
    pipelineMetrics,
    dashboardSummary.enabled,
    dashboardSummary.summary,
    orgWideDashboardScope,
  ]);
  const pipelineValue = displayPipelineMetrics.total;
  const displayPipelineByStage = React.useMemo(() => {
    const summary = dashboardSummary.summary;
    if (!dashboardSummary.enabled || !summary || !orgWideDashboardScope) return null;
    const byStage = summary.pipelineByStage;
    if (!byStage || typeof byStage !== "object") return null;
    return byStage;
  }, [dashboardSummary.enabled, dashboardSummary.summary, orgWideDashboardScope]);
  const displayChannelMix = React.useMemo(() => {
    const summary = dashboardSummary.summary;
    if (!dashboardSummary.enabled || !summary || !orgWideDashboardScope) return null;
    const mix = summary.channelMix;
    if (!mix || typeof mix !== "object") return null;
    return mix;
  }, [dashboardSummary.enabled, dashboardSummary.summary, orgWideDashboardScope]);
  const displayFunnelByChannel = React.useMemo(() => {
    const summary = dashboardSummary.summary;
    if (!dashboardSummary.enabled || !summary || !orgWideDashboardScope) return null;
    const byChannel = summary.funnelByChannel;
    if (!byChannel || typeof byChannel !== "object") return null;
    return byChannel;
  }, [dashboardSummary.enabled, dashboardSummary.summary, orgWideDashboardScope]);
  const liveClosedValue = scopedDeals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);
  const liveWonDealCount = scopedDeals.filter((d) => d.stage === "won").length;
  const summaryClosed = React.useMemo(() => {
    if (!dashboardSummary.enabled || !orgWideDashboardScope) return null;
    return summaryClosedRevenue(dashboardSummary.summary, timeRange);
  }, [
    dashboardSummary.enabled,
    dashboardSummary.summary,
    orgWideDashboardScope,
    timeRange,
  ]);
  const closedValue = summaryClosed?.closedRevenue ?? liveClosedValue;
  const wonDealCount = summaryClosed?.wonDealCount ?? liveWonDealCount;

  const viewer = React.useMemo(
    () => (currentUserId ? getUserById(currentUserId) : undefined),
    [currentUserId, getUserById],
  );
  const permissionSubject = React.useMemo(
    () => ({
      roleId: viewer?.roleId ?? navAccess.roleId ?? "salesperson",
      isSuperAdmin: Boolean(viewer?.isSuperAdmin || navAccess.isSuperAdmin),
      featureGrants: viewer?.featureGrants ?? navAccess.featureGrants,
      orgRole: viewer?.orgRole ?? navAccess.orgRole,
      roleSnapshot: navAccess.roleSnapshot,
    }),
    [viewer, navAccess],
  );
  const canCustomizeLayout = showOwnerOpsDashboard(viewer, viewerOrgRole, permissionSubject);
  const canExportDashboard = canAction(permissionSubject, "dashboard.export");
  const canViewOutreachCampaigns = can(permissionSubject, "email_outreach", "view");
  const {
    prefs,
    setViewMode,
    setPreviewRole,
    exitPreview,
    setWidget,
    setAllWidgets,
    setChannelFunnelVisible,
    setAllChannelFunnelsVisible,
    reset,
  } = useDashboardPreferences(currentUserId || "anon");

  const effectiveRole = resolveEffectiveDashboardRole(viewer?.roleId, prefs);
  const scopedOwnerId = ownerScope.startsWith(OWNER_SCOPE_PREFIX)
    ? ownerScope.slice(OWNER_SCOPE_PREFIX.length)
    : null;
  const scopedOwner = scopedOwnerId ? getUserById(scopedOwnerId) : undefined;
  /** Director/manager picking a content_team teammate should see that person's content board. */
  const viewingTeammateContent =
    prefs.viewMode === "auto" &&
    !prefs.previewRole &&
    Boolean(scopedOwner && isContentOpsDashboardRole(scopedOwner.roleId));
  const contentLayout =
    resolveContentLayout(effectiveRole, prefs) || viewingTeammateContent;
  const frontlineLayout = viewingTeammateContent
    ? false
    : resolveFrontlineLayout(effectiveRole, prefs);
  const opsLayout = viewingTeammateContent
    ? false
    : resolveOpsLayout(canCustomizeLayout, effectiveRole, prefs);
  const contentBoardUserId = viewingTeammateContent && scopedOwnerId ? scopedOwnerId : currentUserId;
  const contentBoardSubjectLabel = viewingTeammateContent
    ? scopedOwner?.displayName?.trim() ||
      (scopedOwnerId ? getOwnerDisplayName(scopedOwnerId)?.trim() : undefined) ||
      ownerFilterTriggerLabel
    : undefined;
  const bannerRole = viewingTeammateContent ? ("content_team" as const) : (effectiveRole ?? viewer?.roleId);
  /** Keep owner picker visible when drilling into a content teammate so you can leave that view. */
  const showDashboardFilters = !contentLayout || viewingTeammateContent;
  const orgRole = (viewerOrgRole ?? viewer?.orgRole) as OrgMemberRole | undefined;
  const orgMeetingsScope = orgRole ? roleAtLeast(orgRole, "manager") : false;
  const w = prefs.widgets;
  const canViewMailboxUtilization = canAction(
    permissionSubject,
    "dashboard.view_mailbox_utilization",
  );
  const opsWidgets = React.useMemo(
    () => ({
      ...w,
      mailboxUtilization: w.mailboxUtilization && canViewMailboxUtilization,
    }),
    [w, canViewMailboxUtilization],
  );
  const pipelineHint = React.useMemo(() => {
    const parts = [
      `${displayPipelineMetrics.openDealCount} open deal${displayPipelineMetrics.openDealCount === 1 ? "" : "s"}`,
    ];
    if (displayPipelineMetrics.leadEstimateContributors > 0) {
      parts.push(
        `${displayPipelineMetrics.leadEstimateContributors} lead estimate${displayPipelineMetrics.leadEstimateContributors === 1 ? "" : "s"}`,
      );
    }
    return parts.join(" · ");
  }, [displayPipelineMetrics.leadEstimateContributors, displayPipelineMetrics.openDealCount]);

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
          const fromSummary = displayFunnelByChannel?.[key];
          return {
            channel: key,
            title: meta?.label ?? key,
            // Manual activityCounters retired — funnel stages from pipeline only.
            counts:
              fromSummary ??
              aggregateChannelFunnelCounts(key, [], scopedSalesLeads, scopedDeals),
          };
        }),
    [
      funnelChannelKeys,
      prefs.channelFunnelsVisible,
      scopedSalesLeads,
      scopedDeals,
      displayFunnelByChannel,
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
        { label: "Open sales leads", value: String(displayMetrics.openSalesLeads) },
        { label: "Prospects", value: String(displayMetrics.prospects) },
        { label: "Prospects need routing", value: String(displayMetrics.prospectsNeedRouting) },
        { label: "Prospects need sequence", value: String(displayMetrics.prospectsNeedSequence) },
        { label: "Prospects ready to push", value: String(displayMetrics.prospectsReadyToPush) },
        { label: "Prospects pushed", value: String(displayMetrics.prospectsPushed) },
        { label: "Follow-ups due", value: String(displayMetrics.followupsDue) },
        { label: "Active sequences", value: String(displayMetrics.activeSequences) },
        { label: "Sequence steps remaining", value: String(displayMetrics.remainingSequenceSteps) },
        { label: "Sequences paused on reply", value: String(displayMetrics.pausedOnReply) },
        { label: "Total replies", value: String(displayMetrics.totalReplies) },
        { label: "Replies in range", value: String(displayMetrics.repliesInRange) },
        { label: "Replies pending review", value: String(displayMetrics.repliesPendingReview) },
        { label: "Emails sent in range", value: String(displayMetrics.sentInRange) },
        { label: "Emails opened in range", value: String(displayMetrics.opensInRange) },
        { label: "Emails scheduled", value: String(displayMetrics.scheduledSteps) },
        { label: "Emails need schedule", value: String(displayMetrics.readyUnscheduledSteps) },
        { label: "Email failures", value: String(displayMetrics.failedDeliveries) },
        ...(displayMetrics.retryingDeliveries > 0
          ? [{ label: "Email retrying", value: String(displayMetrics.retryingDeliveries) }]
          : []),
        { label: "Emails bounced in range", value: String(displayMetrics.bouncedEmailsInRange) },
        {
          label: "Open bounce review tasks",
          value: String(displayMetrics.openBounceReviewTasks),
        },
        { label: "My open tasks", value: String(displayMetrics.myOpenTasks) },
        { label: "Pipeline value (USD)", value: String(Math.round(pipelineValue)) },
        { label: "Closed revenue (USD)", value: String(Math.round(closedValue)) },
        {
          label: "Open deals",
          value: String(displayPipelineMetrics.openDealCount),
        },
        { label: "Won deals", value: String(wonDealCount) },
        { label: "Idle leads", value: String(displayMetrics.idleSalesLeads) },
        {
          label: "Avg first outreach (minutes)",
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
        description={getDashboardOverviewDescription(bannerRole)}
        actions={
          <>
            {canCustomizeLayout ? (
              <Link
                href={buildDashboardWallHref(timeRange as DashboardTimeRangeKey)}
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
                canPreviewAsRole={canAction(permissionSubject, "dashboard.preview_as_role")}
                onViewModeChange={setViewMode}
                onPreviewRoleChange={setPreviewRole}
                onWidgetChange={setWidget}
                onEnableAll={() => setAllWidgets(true)}
                onDisableAll={() => setAllWidgets(false)}
                onReset={reset}
              />
            ) : null}
            {!showDashboardFilters ? null : (
              <>
            <Select
              value={timeRange}
              onValueChange={(v) => {
                if (!v || v === timeRange) return;
                const next = parseDashboardTimeRangeKey(v, timeRange as DashboardTimeRangeKey);
                setTimeRange(next);
                router.replace(buildDashboardHref(next), { scroll: false });
              }}
            >
              <SelectTrigger size="sm" className="w-auto min-w-40 gap-1.5 whitespace-nowrap">
                <Calendar className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                <SelectValue className="whitespace-nowrap">
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
            {!viewingTeammateContent ? (
              <>
            <Button variant="outline" size="sm" type="button" onClick={openFilterDialog} className="gap-1.5">
              <Filter className="h-3.5 w-3.5" /> Filter
              {channelScope.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                  {channelScope.length}
                </Badge>
              )}
            </Button>
            {canExportDashboard ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={exportOverviewCsv}
                disabled={!isDemo && leads.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export
              </Button>
            ) : null}
              </>
            ) : null}
              </>
            )}          </>
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
        ) : !isDemo && leads.length === 0 && !contentLayout ? (
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
                    : `View: ${
                        prefs.viewMode === "ops"
                          ? "Owner command board"
                          : prefs.viewMode === "classic"
                            ? "Pipeline classic"
                            : prefs.viewMode === "content"
                              ? "Content board"
                              : "Employee board"
                      }`}
                </span>
                <span className="text-muted-foreground">Layout only - data access is unchanged.</span>
                <button
                  type="button"
                  className="ml-auto text-primary underline-offset-4 hover:underline"
                  onClick={exitPreview}
                >
                  Exit preview
                </button>
              </div>
            )}
            {viewer && (
              <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3">
                <p className="text-xs font-semibold text-foreground">
                  {roleLabel(bannerRole)} view
                  {viewingTeammateContent && contentBoardSubjectLabel
                    ? ` · ${contentBoardSubjectLabel}`
                    : null}
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {viewingTeammateContent
                    ? `Showing ${contentBoardSubjectLabel ?? "this teammate"}'s content plate — the same board they see when signed in.`
                    : getDashboardRoleFocusLine(bannerRole)}
                </p>
              </div>
            )}
            {can(permissionSubject, "content_calendar", "view") ? (
              <CaptureDutyBanner />
            ) : null}
            {contentLayout ? (
              <ContentOpsBoard
                currentUserId={contentBoardUserId}
                subjectLabel={contentBoardSubjectLabel}
              />
            ) : (
              <>
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
                metrics={displayMetrics}
                leads={scopedLeads}
                deals={scopedDeals}
                followups={workflowFollowups}
                plans={workflowPlans}
                tasks={workflowTasks}
                contacts={contacts}
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
                widgets={opsWidgets}
                isDemo={isDemo}
              />
            ) : frontlineLayout ? (
              <FrontlineBoard
                role={effectiveRole}
                metrics={displayMetrics}
                leads={scopedLeads}
                followups={workflowFollowups}
                plans={workflowPlans}
                tasks={workflowTasks}
                currentUserId={currentUserId}
                range={timeRange as DashboardTimeRangeKey}
                widgets={opsWidgets}
                pipelineValue={pipelineValue}
                closedValue={closedValue}
                pipelineHint={pipelineHint}
                wonDealCount={wonDealCount}
                avgResponseMin={avgResponseMin}
                isDemo={isDemo}
              />
            ) : w.classicKpis ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 gap-4">
                  <KpiCard
                    label="Open sales leads"
                    value={displayMetrics.openSalesLeads}
                    hint={`${displayMetrics.idleSalesLeads} idle`}
                    icon={Target}
                    href="/leads"
                    tone={
                      displayMetrics.idleSalesLeads > 0
                        ? "warn"
                        : displayMetrics.openSalesLeads > 0
                          ? "info"
                          : "default"
                    }
                  />
                  <KpiCard
                    label="Prospects"
                    value={scopedProspects.length}
                    hint={`${displayMetrics.prospectsNeedRouting} need routing · ${displayMetrics.prospectsNeedSequence} need sequence · ${displayMetrics.prospectsReadyToPush} ready to push · ${displayMetrics.prospectsPushed} pushed`}
                    icon={UserRoundSearch}
                    href="/prospects"
                    tone={
                      displayMetrics.prospectsNeedRouting > 0 ||
                      displayMetrics.prospectsNeedSequence > 0 ||
                      displayMetrics.prospectsReadyToPush > 0
                        ? "warn"
                        : scopedProspects.length > 0
                          ? "info"
                          : "default"
                    }
                  />
                  <KpiCard
                    label="Total replies"
                    value={displayMetrics.totalReplies}
                    hint={`${displayMetrics.repliesInRange} in ${DASHBOARD_TIME_RANGE_LABELS[timeRange as DashboardTimeRangeKey].toLowerCase()} · ${displayMetrics.repliesPendingReview} to review`}
                    icon={MessageSquareReply}
                    href={buildRepliesDrillHref(timeRange as DashboardTimeRangeKey)}
                    tone={
                      displayMetrics.repliesPendingReview > 0
                        ? "warn"
                        : displayMetrics.repliesInRange > 0
                          ? "success"
                          : "default"
                    }
                  />
                  <KpiCard
                    label="Follow-ups due"
                    value={displayMetrics.followupsDue}
                    hint={`${displayMetrics.overdueFollowups} overdue · ${displayMetrics.remainingSequenceSteps} in sequence · ${displayMetrics.scheduledSteps} scheduled`}
                    icon={CalendarClock}
                    href="/followups"
                    tone={
                      displayMetrics.overdueFollowups > 0
                        ? "danger"
                        : displayMetrics.followupsDue > 0
                          ? "warn"
                          : "default"
                    }
                  />
                  <KpiCard
                    label="Active sequences"
                    value={displayMetrics.activeSequences}
                    hint={`${displayMetrics.remainingSequenceSteps} steps remaining · ${displayMetrics.pausedOnReply} stopped on reply`}
                    icon={Workflow}
                    href="/followups"
                    tone={displayMetrics.activeSequences > 0 ? "info" : "default"}
                  />
                  <KpiCard
                    label="Tasks"
                    value={displayMetrics.myOpenTasks}
                    hint={`${displayMetrics.overdueTasks} overdue · ${displayMetrics.waitingOnOthers} waiting on others`}
                    icon={ListTodo}
                    href="/tasks"
                    tone={
                      displayMetrics.overdueTasks > 0
                        ? "danger"
                        : displayMetrics.myOpenTasks > 0
                          ? "info"
                          : "default"
                    }
                  />
                  <KpiCard
                    label="Email delivery"
                    value={displayMetrics.sentInRange}
                    hint={`${displayMetrics.scheduledSteps} scheduled · ${displayMetrics.readyUnscheduledSteps} need schedule · ${displayMetrics.failedDeliveries} failed${
                      displayMetrics.retryingDeliveries > 0
                        ? ` · ${displayMetrics.retryingDeliveries} retrying`
                        : ""
                    }${
                      displayMetrics.opensInRange > 0
                        ? ` · ${displayMetrics.opensInRange} opened`
                        : ""
                    }${
                      displayMetrics.bouncedEmailsInRange > 0 ||
                      displayMetrics.openBounceReviewTasks > 0
                        ? ` · ${displayMetrics.bouncedEmailsInRange} bounced · ${displayMetrics.openBounceReviewTasks} to review`
                        : ""
                    }`}
                    icon={Send}
                    href="/inbox?folder=scheduled"
                    tone={
                      ((): KpiTone => {
                        if (displayMetrics.failedDeliveries > 0) return "danger";
                        if (
                          displayMetrics.bouncedEmailsInRange > 0 ||
                          displayMetrics.openBounceReviewTasks > 0 ||
                          displayMetrics.readyUnscheduledSteps > 0
                        ) {
                          return "warn";
                        }
                        if (displayMetrics.sentInRange > 0) return "info";
                        return "default";
                      })()
                    }
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
                      tone={pipelineValue > 0 ? "info" : "default"}
                    />
                    <KpiCard
                      label={`Closed (${DASHBOARD_TIME_RANGE_LABELS[timeRange as DashboardTimeRangeKey]})`}
                      value={`$${(closedValue / 1000).toFixed(0)}k`}
                      hint={`${wonDealCount} deals won`}
                      icon={DollarSign}
                      href="/deals"
                      tone={
                        scopedDeals.some((d) => d.stage === "won") ? "success" : "default"
                      }
                    />
                    <KpiCard
                      label="Avg first outreach"
                      value={avgResponseMin != null ? `${avgResponseMin.toFixed(0)}m` : "-"}
                      hint="Sales lead created → first outbound email"
                      deltaType="positive-down"
                      icon={Clock}
                      href="/inbox"
                      tone={
                        avgResponseMin != null && avgResponseMin > 120 ? "warn" : "default"
                      }
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {w.replyReviews ? <DashboardReplyReviews leads={scopedLeads} /> : null}

            {!opsLayout && can(permissionSubject, "content_calendar", "view") ? (
              <MyContentPlate currentUserId={currentUserId} />
            ) : null}

            {!opsLayout && !frontlineLayout && w.needsAttention ? (
              <DashboardNeedsAttentionWithContent
                leads={scopedLeads}
                followups={workflowFollowups}
                plans={workflowPlans}
                tasks={workflowTasks}
                currentUserId={currentUserId}
                contentScope="mine"
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
                {w.pipelineDistribution ? (
                  <PipelineDistribution
                    leads={scopedSalesLeads}
                    stageCounts={displayPipelineByStage}
                  />
                ) : null}
              </div>
            ) : null}

            {!opsLayout && w.channelFunnels ? (
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

            {!opsLayout && (w.scorecard || w.channelMix || w.idleLeads) ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="flex flex-col gap-4 xl:col-span-2">
                  {w.scorecard ? (
                    <PersonScorecard
                      leads={scopedSalesLeads}
                      deals={scopedDeals}
                      followups={workflowFollowups}
                      tasks={workflowTasks}
                      range={timeRange as DashboardTimeRangeKey}
                    />
                  ) : null}
                  {w.channelMix ? (
                    <ChannelMix leads={scopedSalesLeads} channelMix={displayChannelMix} />
                  ) : null}
                </div>
                {w.idleLeads ? <IdleLeads leads={scopedSalesLeads} /> : null}
              </div>
            ) : null}

            {!opsLayout &&
            campaigns.length > 0 &&
            w.campaigns &&
            canViewOutreachCampaigns ? (
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
          </>
        )}
      </PageBody>
    </>
  );
}
