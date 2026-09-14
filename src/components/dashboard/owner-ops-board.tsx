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
import { TeamCommand } from "@/components/dashboard/team-command";
import { StrategyScoreboard } from "@/components/dashboard/strategy-scoreboard";
import { DashboardNeedsAttentionWithContent } from "@/components/dashboard/dashboard-needs-attention-with-content";
import { ContentWallBoard } from "@/components/dashboard/content-wall-board";
import {
  WallSceneCarousel,
  type WallScene,
} from "@/components/dashboard/wall-scene-carousel";
import { useDashboardMeetings } from "@/hooks/use-dashboard-meetings";
import {
  buildDashboardWallHref,
  type DashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import type { DashboardWidgets } from "@/lib/dashboard-preferences";
import { defaultWallPreferences, type WallPreferences } from "@/lib/wall-preferences";
import type {
  ActivityRecord,
  Contact,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  OrgActivityEvent,
  TimelineEvent,
  User,
} from "@/lib/types";

const chartLoading = (compact?: boolean) => (
  <div
    className={cn(
      "animate-pulse rounded-lg border bg-muted/20",
      compact ? "h-36" : "h-[280px]",
    )}
  />
);

const EmailVolumeChart = dynamic(
  () =>
    import("@/components/dashboard/email-volume-chart").then((m) => ({
      default: m.EmailVolumeChart,
    })),
  {
    ssr: false,
    loading: () => chartLoading(),
  },
);

const FollowupScheduleChart = dynamic(
  () =>
    import("@/components/dashboard/followup-schedule-chart").then((m) => ({
      default: m.FollowupScheduleChart,
    })),
  {
    ssr: false,
    loading: () => chartLoading(),
  },
);

const EmailVolumeChartWall = dynamic(
  () =>
    import("@/components/dashboard/email-volume-chart").then((m) => ({
      default: m.EmailVolumeChart,
    })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[120px] animate-pulse rounded-lg border bg-muted/20" />,
  },
);

const FollowupScheduleChartWall = dynamic(
  () =>
    import("@/components/dashboard/followup-schedule-chart").then((m) => ({
      default: m.FollowupScheduleChart,
    })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[120px] animate-pulse rounded-lg border bg-muted/20" />,
  },
);

export function OwnerOpsBoard({
  metrics,
  leads,
  deals,
  followups,
  plans,
  tasks,
  contacts,
  users,
  timelineByLead,
  orgActivityEvents,
  activityRecords,
  range,
  /** Channel/owner-scoped but not date-capped - Team Command applies its own window. */
  teamCommandLeads,
  teamCommandDeals,
  teamCommandFollowups,
  currentUserId,
  orgMeetingsScope,
  widgets,
  wall,
  showWallLink,
  isDemo,
  wallPrefs,
  orgWideScope = false,
  extraSentAts,
  emailCardMetrics,
}: {
  metrics: DashboardWorkflowMetrics;
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  plans: FollowupPlan[];
  tasks: LeadTask[];
  contacts?: Contact[];
  users: User[];
  timelineByLead: Record<string, TimelineEvent[]>;
  orgActivityEvents?: OrgActivityEvent[];
  activityRecords?: ActivityRecord[];
  range: DashboardTimeRangeKey;
  teamCommandLeads?: Lead[];
  teamCommandDeals?: Deal[];
  teamCommandFollowups?: Followup[];
  currentUserId: string;
  orgMeetingsScope: boolean;
  widgets: DashboardWidgets;
  wall?: boolean;
  showWallLink?: boolean;
  isDemo?: boolean;
  /** Wall display timing / scene prefs (Settings → Wall). */
  wallPrefs?: WallPreferences;
  /** Org-wide (no channel/owner filters) — enables Redis scoreboards when flag on. */
  orgWideScope?: boolean;
  /** Compose / inbox / reply send timestamps for email volume. */
  extraSentAts?: readonly number[];
  /** Emails pulse tile only — sender/lead ownership rules. */
  emailCardMetrics?: import("@/lib/dashboard-email-kpi-card").EmailKpiCardMetrics | null;
}) {
  const wallSettings = wallPrefs ?? defaultWallPreferences();
  const needMeetings = Boolean(widgets.pulse || widgets.actionBoard || wall);
  const { meetings } = useDashboardMeetings(needMeetings, orgMeetingsScope);
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
  // Team command supersedes the standalone scorecard + top performers here.
  const showScorecard = widgets.scorecard && !widgets.teamCommand;
  const showInboxPerformance = widgets.inboxPerformance && !widgets.teamCommand;
  const showLeft =
    showCharts ||
    widgets.teamCommand ||
    widgets.strategyScoreboard ||
    showScorecard ||
    widgets.needsAttention ||
    showInboxPerformance ||
    widgets.mailboxUtilization;
  const showRight = widgets.activityFeed || widgets.actionBoard;

  const wallScenes = React.useMemo((): WallScene[] => {
    if (!wall) return [];

    const scenes: WallScene[] = [];

    // Scene 1 - Priorities: what needs a decision or action right now.
    const nowWidgets = [
      widgets.needsAttention ? (
        <DashboardNeedsAttentionWithContent
          key="needs"
          leads={leads}
          followups={followups}
          plans={plans}
          tasks={tasks}
          currentUserId={currentUserId}
          contentScope="team"
          wall
          className="min-h-0 flex-1"
        />
      ) : null,
      widgets.actionBoard ? (
        <ActionBoardPanel
          key="action"
          tasks={tasks}
          followups={followups}
          meetings={meetings}
          leads={leads}
          wall
          className="min-h-0 flex-1"
        />
      ) : null,
      widgets.activityFeed ? (
        <OpsActivityFeed
          key="activity"
          timelineByLead={timelineByLead}
          orgActivityEvents={orgActivityEvents}
          activityRecords={activityRecords}
          wall
          className="h-full max-h-none min-h-0 flex-1"
        />
      ) : null,
    ].filter(Boolean);

    if (nowWidgets.length > 0 && wallSettings.scenes.priorities) {
      scenes.push({
        id: "now",
        label: "Priorities",
        tagline: "Handle these now",
        content: (
          <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">{nowWidgets}</div>
        ),
      });
    }

    // Scene 2 - Team & capacity: who is delivering and where the send capacity is.
    const teamCard = widgets.teamCommand ? (
      <TeamCommand
        key="team"
        leads={teamCommandLeads ?? leads}
        deals={teamCommandDeals ?? deals}
        followups={teamCommandFollowups ?? followups}
        tasks={tasks}
        range={range}
        orgWideScope={orgWideScope}
        wall
        className="min-h-0 flex-1"
      />
    ) : showScorecard ? (
      <div key="scorecard" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PersonScorecard
          leads={leads}
          deals={deals}
          followups={followups}
          tasks={tasks}
          range={range}
          orgWideScope={orgWideScope}
          wall
        />
      </div>
    ) : null;

    const capacityStack = widgets.mailboxUtilization || showInboxPerformance ? (
      <div key="capacity" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:max-w-[38%]">
        {showInboxPerformance ? (
          <InboxPerformance
            users={users}
            leads={leads}
            followups={followups}
            range={range}
            orgWideScope={orgWideScope}
            wall
          />
        ) : null}
        {widgets.mailboxUtilization ? (
          <MailboxUtilizationPanel
            isDemo={Boolean(isDemo)}
            currentUserId={currentUserId}
            scope="org"
            wall
            className="min-h-0 flex-1"
          />
        ) : null}
      </div>
    ) : null;

    const teamWidgets = [teamCard, capacityStack].filter(Boolean);
    if (teamWidgets.length > 0 && wallSettings.scenes.team) {
      scenes.push({
        id: "team",
        label: "Team",
        tagline: "Who's owning it",
        content: (
          <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">{teamWidgets}</div>
        ),
      });
    }

    // Scene 3 - Pipeline: strategy health beside outreach/follow-up trends.
    if (wallSettings.scenes.pipeline && (widgets.strategyScoreboard || showCharts)) {
      const chartsColumn = showCharts ? (
        <div
          className={cn(
            "flex min-h-0 flex-col gap-3",
            widgets.strategyScoreboard ? "lg:w-[42%]" : "flex-1",
          )}
        >
          {widgets.emailVolume ? (
            <div className="min-h-0 flex-1">
              <EmailVolumeChartWall
                followups={followups}
                leads={leads}
                contacts={contacts}
                tasks={tasks}
                extraSentAts={extraSentAts}
                fill
              />
            </div>
          ) : null}
          {widgets.followupSchedule ? (
            <div className="min-h-0 flex-1">
              <FollowupScheduleChartWall followups={followups} fill />
            </div>
          ) : null}
        </div>
      ) : null;

      scenes.push({
        id: "pipeline",
        label: "Pipeline",
        tagline: "Engine health",
        content: (
          <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
            {widgets.strategyScoreboard ? (
              <StrategyScoreboard
                leads={leads}
                deals={deals}
                followups={followups}
                range={range}
                orgWideScope={orgWideScope}
                wall
                className="min-h-0 flex-1"
              />
            ) : null}
            {chartsColumn}
          </div>
        ),
      });
    }

    // Scene 4 - Content: brand pulse + production / schedule / capture queues.
    if (wallSettings.scenes.content) {
      scenes.push({
        id: "content",
        label: "Content",
        tagline: "Brands & content ops",
        content: <ContentWallBoard className="h-full min-h-0 flex-1" />,
      });
    }

    return scenes;
  }, [
    wall,
    wallSettings.scenes.priorities,
    wallSettings.scenes.team,
    wallSettings.scenes.pipeline,
    wallSettings.scenes.content,
    widgets,
    showInboxPerformance,
    showScorecard,
    showCharts,
    leads,
    deals,
    followups,
    plans,
    tasks,
    users,
    currentUserId,
    range,
    isDemo,
    teamCommandLeads,
    teamCommandDeals,
    teamCommandFollowups,
    orgWideScope,
    meetings,
    timelineByLead,
    orgActivityEvents,
    activityRecords,
  ]);

  if (wall) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {widgets.pulse && wallSettings.showPulseStrip ? (
          <div className="shrink-0">
            <OpsPulseStrip
              metrics={metrics}
              meetingsToday={meetingsToday}
              openTasksCount={openTasksCount}
              wall
              range={range}
              emailCardMetrics={emailCardMetrics}
            />
          </div>
        ) : null}
        {wallScenes.length > 0 ? (
          <WallSceneCarousel
            scenes={wallScenes}
            dwellMs={wallSettings.dwellSeconds * 1000}
            resumeIdleMs={wallSettings.resumeIdleSeconds * 1000}
            showProgressBar={wallSettings.showProgressBar}
            progressBarPosition={wallSettings.progressBarPosition}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No wall scenes enabled. Turn scenes on in Settings → Wall, or enable widgets in dashboard
            settings.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {showWallLink && widgets.wallLink ? (
        <div className="flex justify-end">
          <Link
            href={buildDashboardWallHref(range)}
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
          range={range}
          emailCardMetrics={emailCardMetrics}
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
                    <EmailVolumeChart
                      followups={followups}
                      leads={leads}
                      contacts={contacts}
                      tasks={tasks}
                      extraSentAts={extraSentAts}
                    />
                  ) : null}
                  {widgets.followupSchedule ? (
                    <FollowupScheduleChart followups={followups} />
                  ) : null}
                </div>
              ) : null}
              {widgets.teamCommand ? (
                <TeamCommand
                  leads={teamCommandLeads ?? leads}
                  deals={teamCommandDeals ?? deals}
                  followups={teamCommandFollowups ?? followups}
                  tasks={tasks}
                  range={range}
                  orgWideScope={orgWideScope}
                />
              ) : null}
              {widgets.strategyScoreboard ? (
                <StrategyScoreboard
                  leads={leads}
                  deals={deals}
                  followups={followups}
                  range={range}
                  orgWideScope={orgWideScope}
                />
              ) : null}
              {showScorecard ? (
                <PersonScorecard
                  leads={leads}
                  deals={deals}
                  followups={followups}
                  tasks={tasks}
                  range={range}
                  orgWideScope={orgWideScope}
                />
              ) : null}
              {widgets.needsAttention ? (
                <DashboardNeedsAttentionWithContent
                  leads={leads}
                  followups={followups}
                  plans={plans}
                  tasks={tasks}
                  currentUserId={currentUserId}
                  contentScope="team"
                />
              ) : null}
              {showInboxPerformance ? (
                <InboxPerformance
                  users={users}
                  leads={leads}
                  followups={followups}
                  range={range}
                  orgWideScope={orgWideScope}
                />
              ) : null}
              {widgets.mailboxUtilization ? (
                <MailboxUtilizationPanel
                  isDemo={Boolean(isDemo)}
                  currentUserId={currentUserId}
                  scope="org"
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
                  leads={leads}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
