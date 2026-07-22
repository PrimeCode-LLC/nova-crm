"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Clock, DollarSign, MessageSquareReply, TrendingUp, UserRoundSearch } from "lucide-react";
import { OpsPulseStrip, type OpsPulseFocus } from "@/components/dashboard/ops-pulse-strip";
import { ActionBoardPanel } from "@/components/dashboard/action-board-panel";
import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { KpiCard } from "@/components/common/kpi-card";
import { buttonVariants } from "@/components/ui/button";
import { useDashboardMeetings } from "@/hooks/use-dashboard-meetings";
import { DASHBOARD_TIME_RANGE_LABELS, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import type { DashboardWidgets } from "@/lib/dashboard-preferences";
import { cn } from "@/lib/utils";
import type { Followup, FollowupPlan, Lead, LeadTask, Role } from "@/lib/types";

function pulseFocusForRole(role: Role | undefined): OpsPulseFocus {
  if (role === "prospecting" || role === "data_scraper") return "prospecting";
  return "sales";
}

export function FrontlineBoard({
  role,
  metrics,
  leads,
  followups,
  plans,
  tasks,
  currentUserId,
  range,
  widgets,
  pipelineValue,
  closedValue,
  pipelineHint,
  wonDealCount,
  avgResponseMin,
}: {
  role: Role | undefined;
  metrics: DashboardWorkflowMetrics;
  leads: Lead[];
  followups: Followup[];
  plans: FollowupPlan[];
  tasks: LeadTask[];
  currentUserId: string;
  range: DashboardTimeRangeKey;
  widgets: DashboardWidgets;
  pipelineValue: number;
  closedValue: number;
  pipelineHint: string;
  wonDealCount: number;
  avgResponseMin: number | null;
}) {
  const isProspecting = role === "prospecting" || role === "data_scraper";
  const focus = pulseFocusForRole(role);
  const { meetings } = useDashboardMeetings(Boolean(widgets.actionBoard || widgets.pulse), false);

  const meetingsToday = React.useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const a = start.getTime();
    const b = end.getTime();
    return meetings.filter((m) => {
      if (m.status !== "scheduled") return false;
      const t = new Date(m.startAt).getTime();
      return t >= a && t < b;
    }).length;
  }, [meetings]);

  const myTasks = React.useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.completedAt &&
          (!t.assigneeId || t.assigneeId === currentUserId),
      ),
    [tasks, currentUserId],
  );

  const myFollowups = React.useMemo(
    () =>
      followups.filter(
        (f) => !f.completedAt && (!f.ownerId || f.ownerId === currentUserId),
      ),
    [followups, currentUserId],
  );

  const showPipeline = widgets.pipelineKpis && !isProspecting;

  return (
    <div className="space-y-4">
      {widgets.pulse ? (
        <OpsPulseStrip
          metrics={metrics}
          meetingsToday={meetingsToday}
          openTasksCount={metrics.myOpenTasks}
          pipelineLabel={isProspecting ? "your day" : "your pipeline"}
          focus={focus}
        />
      ) : null}

      {isProspecting ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-muted/15 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-semibold text-foreground">Prospecting focus</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Route prospects that need a channel, push ready ones to sales, then clear follow-ups on
              your handoffs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/prospects"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <UserRoundSearch className="h-3.5 w-3.5" />
              Prospects
              {metrics.prospectsNeedRouting > 0 ? (
                <span className="tabular-nums text-warning">· {metrics.prospectsNeedRouting}</span>
              ) : null}
            </Link>
            <Link
              href="/my-strategy"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <BookOpen className="h-3.5 w-3.5" />
              My Strategy
            </Link>
          </div>
        </div>
      ) : null}

      {showPipeline ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <KpiCard
            label="Pipeline value"
            value={`$${(pipelineValue / 1000).toFixed(0)}k`}
            hint={pipelineHint}
            icon={TrendingUp}
            href="/deals"
            tone={pipelineValue > 0 ? "info" : "default"}
          />
          <KpiCard
            label={`Closed (${DASHBOARD_TIME_RANGE_LABELS[range]})`}
            value={`$${(closedValue / 1000).toFixed(0)}k`}
            hint={`${wonDealCount} deals won`}
            icon={DollarSign}
            href="/deals"
            tone={wonDealCount > 0 ? "success" : "default"}
          />
          <KpiCard
            label="Avg response"
            value={avgResponseMin != null ? `${avgResponseMin.toFixed(0)}m` : "-"}
            hint="Sales lead created → first outbound email"
            deltaType="positive-down"
            icon={Clock}
            href="/activity"
            tone={avgResponseMin != null && avgResponseMin > 120 ? "warn" : "default"}
          />
        </div>
      ) : null}

      {isProspecting && widgets.pipelineKpis ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            label="Need routing"
            value={metrics.prospectsNeedRouting}
            hint="Assign channels before handoff"
            icon={UserRoundSearch}
            href="/prospects"
            tone={metrics.prospectsNeedRouting > 0 ? "warn" : "default"}
          />
          <KpiCard
            label="Pushed to sales"
            value={metrics.prospectsPushed}
            hint="Linked sales leads in scope"
            icon={TrendingUp}
            href="/prospects"
            tone={metrics.prospectsPushed > 0 ? "success" : "default"}
          />
          <KpiCard
            label="Replies to review"
            value={metrics.repliesPendingReview}
            hint="Confirm stage or promote"
            icon={MessageSquareReply}
            href="/leads?stage=replied"
            tone={metrics.repliesPendingReview > 0 ? "warn" : "default"}
          />
        </div>
      ) : null}
      {(widgets.actionBoard || widgets.needsAttention) && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {widgets.actionBoard ? (
            <ActionBoardPanel
              tasks={myTasks}
              followups={myFollowups}
              meetings={meetings}
              leads={leads}
              title="My day"
              description="Your overdue work, open tasks, and meetings"
            />
          ) : null}
          {widgets.needsAttention ? (
            <DashboardNeedsAttention
              leads={leads}
              followups={followups}
              plans={plans}
              tasks={tasks}
              currentUserId={currentUserId}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
