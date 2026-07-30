"use client";

import type { ReactNode } from "react";
import { KpiCard, type KpiTone } from "@/components/common/kpi-card";
import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Calendar,
  CalendarClock,
  ListTodo,
  MessageSquareReply,
  Send,
  Target,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";

type HintPart = {
  text: string;
  tone?: "danger" | "warn" | "success" | "info" | "accent";
};

function HintLine({ parts }: { parts: HintPart[] }) {
  if (parts.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      {parts.map((part, i) => (
        <span key={`${part.text}-${i}`} className="inline-flex items-baseline gap-x-1">
          {i > 0 ? <span className="text-muted-foreground/50">·</span> : null}
          <span
            className={cn(
              part.tone === "danger" && "font-medium text-destructive",
              part.tone === "warn" && "font-medium text-warning",
              part.tone === "success" && "font-medium text-success",
              part.tone === "info" && "font-medium text-chart-1",
              part.tone === "accent" && "font-medium text-chart-2",
              !part.tone && "text-muted-foreground",
            )}
          >
            {part.text}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Card color = metric identity. Hint color = urgency (except follow-ups/tasks). */
function emailsTone(metrics: DashboardWorkflowMetrics): KpiTone {
  // Match email volume chart "Sent" (chart-1). Delivery issues stay in the hint.
  return metrics.sentInRange > 0 ? "info" : "default";
}

function repliesTone(metrics: DashboardWorkflowMetrics): KpiTone {
  // Match email volume chart "Replies" (chart-2). "To review" stays amber in the hint.
  return metrics.repliesInRange > 0 ? "accent" : "default";
}

function prospectsTone(_metrics: DashboardWorkflowMetrics): KpiTone {
  // Neutral identity - routing volume is not the same urgency as overdue work.
  return "default";
}

function followupsTone(metrics: DashboardWorkflowMetrics): KpiTone {
  if (metrics.overdueFollowups > 0) return "danger";
  if (metrics.followupsDue > 0) return "warn";
  return "default";
}

function tasksTone(metrics: DashboardWorkflowMetrics): KpiTone {
  // Open ≠ urgent. Only light up when something is overdue.
  return metrics.overdueTasks > 0 ? "danger" : "default";
}

function meetingsTone(meetingsToday: number): KpiTone {
  return meetingsToday > 0 ? "success" : "default";
}

function openLeadsTone(metrics: DashboardWorkflowMetrics): KpiTone {
  // Soft identity when there are open leads; idle stays amber in the hint.
  return metrics.openSalesLeads > 0 ? "info" : "default";
}

export type OpsPulseFocus = "ops" | "sales" | "prospecting";

type PulseItem = {
  key: string;
  label: string;
  value: number;
  hint: ReactNode;
  icon: LucideIcon;
  href: string;
  tone: KpiTone;
};

function buildEmailHints(metrics: DashboardWorkflowMetrics): HintPart[] {
  const emailHints: HintPart[] = [
    { text: `${metrics.scheduledSteps} queued` },
    {
      text: `${metrics.readyUnscheduledSteps} need schedule`,
      tone: metrics.readyUnscheduledSteps > 0 ? "warn" : undefined,
    },
    {
      text: `${metrics.failedDeliveries} failed`,
      tone: metrics.failedDeliveries > 0 ? "danger" : undefined,
    },
  ];
  if (metrics.retryingDeliveries > 0) {
    emailHints.push({ text: `${metrics.retryingDeliveries} retrying`, tone: "warn" });
  }
  if (metrics.bouncedEmailsInRange > 0 || metrics.openBounceReviewTasks > 0) {
    emailHints.push({
      text: `${metrics.bouncedEmailsInRange} bounced`,
      // Match email volume chart bounce series (red).
      tone: metrics.bouncedEmailsInRange > 0 ? "danger" : undefined,
    });
    emailHints.push({
      text: `${metrics.openBounceReviewTasks} to review`,
      tone: metrics.openBounceReviewTasks > 0 ? "warn" : undefined,
    });
  }
  return emailHints;
}

function buildProspectHints(metrics: DashboardWorkflowMetrics): HintPart[] {
  return [
    {
      text: `${metrics.prospectsNeedRouting} need routing`,
      tone: metrics.prospectsNeedRouting > 0 ? "warn" : undefined,
    },
    {
      text: `${metrics.prospectsReadyToPush} ready to push`,
      tone: metrics.prospectsReadyToPush > 0 ? "warn" : undefined,
    },
    {
      text: `${metrics.prospectsPushed} pushed`,
      tone: metrics.prospectsPushed > 0 ? "success" : undefined,
    },
  ];
}

export function OpsPulseStrip({
  metrics,
  meetingsToday,
  openTasksCount,
  pipelineLabel,
  wall,
  focus = "ops",
}: {
  metrics: DashboardWorkflowMetrics;
  meetingsToday: number;
  /** Prefer org/scoped open tasks for ops boards; falls back to myOpenTasks. */
  openTasksCount?: number;
  pipelineLabel?: string;
  wall?: boolean;
  /** Reorders tiles for leadership vs sales vs prospecting day-to-day work. */
  focus?: OpsPulseFocus;
}) {
  const openTasks = openTasksCount ?? metrics.myOpenTasks;
  const emailHints = buildEmailHints(metrics);
  const prospectHints = buildProspectHints(metrics);

  const byKey: Record<string, PulseItem> = {
    emails: {
      key: "emails",
      label: "Emails sent",
      value: metrics.sentInRange,
      hint: <HintLine parts={emailHints} />,
      icon: Send,
      href: "/inbox?folder=scheduled",
      tone: emailsTone(metrics),
    },
    replies: {
      key: "replies",
      label: "Replies",
      value: metrics.repliesInRange,
      hint: (
        <HintLine
          parts={[
            {
              text: `${metrics.repliesPendingReview} to review`,
              tone: metrics.repliesPendingReview > 0 ? "warn" : undefined,
            },
          ]}
        />
      ),
      icon: MessageSquareReply,
      href: "/leads?stage=replied",
      tone: repliesTone(metrics),
    },
    prospects: {
      key: "prospects",
      label: "Prospects",
      value: metrics.prospects,
      hint: <HintLine parts={prospectHints} />,
      icon: UserRoundSearch,
      href: "/prospects",
      tone: prospectsTone(metrics),
    },
    openLeads: {
      key: "openLeads",
      label: "Open leads",
      value: metrics.openSalesLeads,
      hint: (
        <HintLine
          parts={[
            {
              text: `${metrics.idleSalesLeads} idle`,
              tone: metrics.idleSalesLeads > 0 ? "warn" : undefined,
            },
          ]}
        />
      ),
      icon: Target,
      href: "/leads",
      tone: openLeadsTone(metrics),
    },
    followups: {
      key: "followups",
      label: "Follow-ups due",
      value: metrics.followupsDue,
      hint: (
        <HintLine
          parts={[
            {
              text: `${metrics.overdueFollowups} overdue`,
              tone: metrics.overdueFollowups > 0 ? "danger" : undefined,
            },
            {
              text: `${metrics.remainingSequenceSteps} in sequence`,
              tone: metrics.remainingSequenceSteps > 0 ? "info" : undefined,
            },
          ]}
        />
      ),
      icon: CalendarClock,
      href: "/followups",
      tone: followupsTone(metrics),
    },
    tasks: {
      key: "tasks",
      label: "Open tasks",
      value: openTasks,
      hint: (
        <HintLine
          parts={[
            {
              text: `${metrics.overdueTasks} overdue`,
              tone: metrics.overdueTasks > 0 ? "danger" : undefined,
            },
          ]}
        />
      ),
      icon: ListTodo,
      href: "/tasks",
      tone: tasksTone(metrics),
    },
    meetings: {
      key: "meetings",
      label: "Meetings today",
      value: meetingsToday,
      hint: (
        <HintLine
          parts={[
            {
              text: pipelineLabel || "scheduled",
              tone: meetingsToday > 0 ? "success" : undefined,
            },
          ]}
        />
      ),
      icon: Calendar,
      href: "/scheduling",
      tone: meetingsTone(meetingsToday),
    },
  };

  const order: string[] =
    focus === "sales"
      ? ["followups", "tasks", "replies", "meetings", "emails", "openLeads"]
      : focus === "prospecting"
        ? ["prospects", "replies", "followups", "tasks", "emails", "meetings"]
        : ["emails", "replies", "prospects", "followups", "tasks", "meetings"];

  const items = order.map((key) => byKey[key]).filter(Boolean);

  return (
    <div
      className={cn(
        "grid",
        wall ? "gap-2" : "gap-3",
        "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
      )}
    >
      {items.map((item) => (
        <KpiCard
          key={item.key}
          label={item.label}
          value={wall ? fmtNumber(item.value) : item.value}
          hint={item.hint}
          icon={item.icon}
          href={wall ? undefined : item.href}
          dense={wall}
          tone={item.tone}
          className={cn(
            wall && "backdrop-blur-sm",
            wall && item.tone === "default" && "border-border/60 bg-card/80",
          )}
        />
      ))}
    </div>
  );
}
