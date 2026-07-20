"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { OpsPulseStrip } from "@/components/dashboard/ops-pulse-strip";
import { cn } from "@/lib/utils";
import { OpsActivityFeed } from "@/components/dashboard/ops-activity-feed";
import { InboxPerformance } from "@/components/dashboard/inbox-performance";
import { MailboxUtilizationPanel } from "@/components/dashboard/mailbox-utilization-panel";
import { ActionBoardPanel } from "@/components/dashboard/action-board-panel";
import { PersonScorecard } from "@/components/dashboard/person-scorecard";
import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { useDashboardMeetings } from "@/hooks/use-dashboard-meetings";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import type { DashboardWidgets } from "@/lib/dashboard-preferences";
import type {
  ActivityRecord,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  OrgActivityEvent,
  TimelineEvent,
  User,
} from "@/lib/types";

const EmailVolumeChart = dynamic(
  () =>
    import("@/components/dashboard/email-volume-chart").then((m) => ({
      default: m.EmailVolumeChart,
    })),
  {
    ssr: false,
    loading: () => <div className="h-[280px] animate-pulse rounded-lg border bg-muted/20" />,
  },
);

const FollowupScheduleChart = dynamic(
  () =>
    import("@/components/dashboard/followup-schedule-chart").then((m) => ({
      default: m.FollowupScheduleChart,
    })),
  {
    ssr: false,
    loading: () => <div className="h-[280px] animate-pulse rounded-lg border bg-muted/20" />,
  },
);

export function OwnerOpsBoard({
  metrics,
  leads,
  deals,
  followups,
  plans,
  tasks,
  users,
  timelineByLead,
  orgActivityEvents,
  activityRecords,
  range,
  currentUserId,
  orgMeetingsScope,
  widgets,
  wall,
  showWallLink,
  isDemo,
}: {
  metrics: DashboardWorkflowMetrics;
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  plans: FollowupPlan[];
  tasks: LeadTask[];
  users: User[];
  timelineByLead: Record<string, TimelineEvent[]>;
  orgActivityEvents?: OrgActivityEvent[];
  activityRecords?: ActivityRecord[];
  range: DashboardTimeRangeKey;
  currentUserId: string;
  orgMeetingsScope: boolean;
  widgets: DashboardWidgets;
  wall?: boolean;
  showWallLink?: boolean;
  isDemo?: boolean;
}) {
  const { meetings } = useDashboardMeetings(true, orgMeetingsScope);
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

  const openTasksCount = React.useMemo(
    () => tasks.filter((t) => !t.completedAt).length,
    [tasks],
  );

  const showCharts = widgets.emailVolume || widgets.followupSchedule;
  const showLeft =
    showCharts ||
    widgets.scorecard ||
    widgets.needsAttention ||
    widgets.inboxPerformance ||
    widgets.mailboxUtilization;
  const showRight = widgets.activityFeed || widgets.actionBoard;

  return (
    <div className="flex flex-col gap-4">
      {!wall && showWallLink && widgets.wallLink ? (
        <div className="flex justify-end">
          <Link
            href="/dashboard/wall"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <Monitor className="h-3.5 w-3.5" />
            Wall mode
          </Link>
        </div>
      ) : null}

      {widgets.pulse ? (
        <OpsPulseStrip
          metrics={metrics}
          meetingsToday={meetingsToday}
          openTasksCount={openTasksCount}
          wall={wall}
        />
      ) : null}

      {showLeft || showRight ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {showLeft ? (
            <div
              className={cn(
                "flex min-w-0 flex-col gap-4",
                showRight ? "xl:col-span-8" : "xl:col-span-12",
              )}
            >
              {showCharts ? (
                <div
                  className={cn(
                    "grid grid-cols-1 gap-4",
                    widgets.emailVolume && widgets.followupSchedule && "lg:grid-cols-2",
                  )}
                >
                  {widgets.emailVolume ? (
                    <EmailVolumeChart followups={followups} leads={leads} compact={wall} />
                  ) : null}
                  {widgets.followupSchedule ? (
                    <FollowupScheduleChart followups={followups} compact={wall} />
                  ) : null}
                </div>
              ) : null}
              {widgets.scorecard ? (
                <PersonScorecard
                  leads={leads}
                  deals={deals}
                  followups={followups}
                  tasks={tasks}
                  range={range}
                  wall={wall}
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
              {widgets.inboxPerformance ? (
                <InboxPerformance
                  users={users}
                  leads={leads}
                  followups={followups}
                  range={range}
                  wall={wall}
                />
              ) : null}
              {widgets.mailboxUtilization ? (
                <MailboxUtilizationPanel
                  isDemo={Boolean(isDemo)}
                  currentUserId={currentUserId}
                  wall={wall}
                />
              ) : null}
            </div>
          ) : null}

          {showRight ? (
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-4 xl:h-full",
                showLeft ? "xl:col-span-4" : "xl:col-span-12",
              )}
            >
              {widgets.activityFeed ? (
                <OpsActivityFeed
                  timelineByLead={timelineByLead}
                  orgActivityEvents={orgActivityEvents}
                  activityRecords={activityRecords}
                  wall={wall}
                  className={cn(
                    "min-h-[320px]",
                    widgets.actionBoard ? "max-h-[min(70vh,560px)] xl:max-h-none xl:flex-1" : "flex-1",
                  )}
                />
              ) : null}
              {widgets.actionBoard ? (
                <ActionBoardPanel
                  tasks={tasks}
                  followups={followups}
                  meetings={meetings}
                  wall={wall}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
