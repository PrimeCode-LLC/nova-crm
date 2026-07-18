"use client";

import { KpiCard } from "@/components/common/kpi-card";
import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Calendar,
  CalendarClock,
  ListTodo,
  MessageSquareReply,
  Send,
  UserRoundSearch,
} from "lucide-react";

export function OpsPulseStrip({
  metrics,
  meetingsToday,
  openTasksCount,
  pipelineLabel,
  wall,
}: {
  metrics: DashboardWorkflowMetrics;
  meetingsToday: number;
  /** Prefer org/scoped open tasks for ops boards; falls back to myOpenTasks. */
  openTasksCount?: number;
  pipelineLabel?: string;
  wall?: boolean;
}) {
  const items = [
    {
      label: "Emails sent",
      value: metrics.sentInRange,
      hint: `${metrics.scheduledSteps} queued · ${metrics.failedDeliveries} failed`,
      icon: Send,
      href: "/inbox?folder=scheduled",
    },
    {
      label: "Replies",
      value: metrics.repliesInRange,
      hint: `${metrics.repliesPendingReview} to review`,
      icon: MessageSquareReply,
      href: "/leads?stage=replied",
    },
    {
      label: "Prospects",
      value: metrics.prospects,
      hint: `${metrics.prospectsNeedRouting} need routing`,
      icon: UserRoundSearch,
      href: "/prospects",
    },
    {
      label: "Follow-ups due",
      value: metrics.followupsDue,
      hint: `${metrics.overdueFollowups} overdue`,
      icon: CalendarClock,
      href: "/followups",
    },
    {
      label: "Open tasks",
      value: openTasksCount ?? metrics.myOpenTasks,
      hint: `${metrics.overdueTasks} overdue`,
      icon: ListTodo,
      href: "/tasks",
    },
    {
      label: "Meetings today",
      value: meetingsToday,
      hint: pipelineLabel,
      icon: Calendar,
      href: "/scheduling",
    },
  ];

  return (
    <div
      className={cn(
        "grid gap-3",
        wall
          ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
          : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
      )}
    >
      {items.map((item) => (
        <KpiCard
          key={item.label}
          label={item.label}
          value={wall ? fmtNumber(item.value) : item.value}
          hint={item.hint}
          icon={item.icon}
          href={wall ? undefined : item.href}
          className={cn(wall && "border-border/60 bg-card/80 backdrop-blur-sm")}
        />
      ))}
    </div>
  );
}
