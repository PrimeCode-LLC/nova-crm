"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckSquare,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CHANNELS } from "@/lib/constants";
import { buildActionBoard } from "@/lib/dashboard-ops-analytics";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ChannelKey,
  Followup,
  LeadTask,
  Meeting,
  MeetingLocationType,
} from "@/lib/types";

const TASK_TYPE_LABEL: Record<LeadTask["taskType"], string> = {
  review: "Review",
  email: "Email",
  call: "Call",
  document: "Document",
  other: "Other",
};

const LOCATION_LABEL: Record<MeetingLocationType, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Teams",
  phone: "Phone",
  in_person: "In person",
  custom: "Custom",
};

function channelLabel(channel: Followup["channel"]): string | null {
  if (!channel || channel === "other") return channel === "other" ? "Other" : null;
  return CHANNELS[channel as ChannelKey]?.short ?? channel;
}

function StatChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "danger" | "warn" | "info" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "info" && "border-chart-1/30 bg-chart-1/5",
        (!tone || tone === "muted") && "border-border bg-muted/30",
      )}
    >
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "info" && "text-chart-1",
        )}
      >
        {count}
      </span>
    </div>
  );
}

function Column({
  title,
  icon: Icon,
  count,
  empty,
  tone,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  empty: string;
  tone?: "danger" | "warn" | "info";
  children: React.ReactNode;
}) {
  const hasKids = React.Children.count(children) > 0;
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border bg-card/40">
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5",
          tone === "danger" && "bg-destructive/5",
          tone === "warn" && "bg-amber-500/5",
          tone === "info" && "bg-chart-1/5",
        )}
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon
            className={cn(
              "h-3.5 w-3.5",
              tone === "danger" && "text-destructive",
              tone === "warn" && "text-amber-600 dark:text-amber-400",
              tone === "info" && "text-chart-1",
              !tone && "text-muted-foreground",
            )}
          />
          {title}
        </div>
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
          {count}
        </Badge>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2.5">
          {hasKids ? children : <p className="px-1 py-6 text-center text-sm text-muted-foreground">{empty}</p>}
        </div>
      </ScrollArea>
    </section>
  );
}

function TaskRow({ task, urgent }: { task: LeadTask; urgent?: boolean }) {
  const context = [task.contextCompany, task.contextContact].filter(Boolean).join(" · ");
  return (
    <Link
      href={task.leadId ? `/leads/${task.leadId}` : "/tasks"}
      className={cn(
        "group block rounded-lg border px-3 py-2.5 transition-colors",
        urgent
          ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
          : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {TASK_TYPE_LABEL[task.taskType]}
        </Badge>
        {task.dueAt ? (
          <span
            className={cn(
              "text-[11px]",
              urgent ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {urgent ? `Due ${fmtRelative(task.dueAt)}` : fmtDate(task.dueAt, "MMM d · h:mm a")}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">No due date</span>
        )}
      </div>
      {context ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{context}</p>
      ) : null}
      {task.description ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/90">{task.description}</p>
      ) : null}
    </Link>
  );
}

function FollowupRow({ followup }: { followup: Followup }) {
  const channel = channelLabel(followup.channel);
  return (
    <Link
      href={followup.leadId ? `/leads/${followup.leadId}` : "/followups"}
      className="group block rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 transition-colors hover:bg-amber-500/10"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{followup.title}</p>
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {channel ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
            {channel}
          </Badge>
        ) : null}
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal capitalize">
          {followup.priority}
        </Badge>
        <span className="text-[11px] text-muted-foreground">Due {fmtRelative(followup.dueAt)}</span>
      </div>
      {followup.emailSubject ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{followup.emailSubject}</p>
      ) : null}
    </Link>
  );
}

function MeetingRow({ meeting, today }: { meeting: Meeting; today?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        today ? "border-chart-1/30 bg-chart-1/5" : "bg-background/40",
      )}
    >
      <div className="flex items-start gap-2">
        {today ? (
          <Badge variant="secondary" className="mt-0.5 h-5 shrink-0 px-1.5 text-[10px]">
            Today
          </Badge>
        ) : null}
        <p className="text-sm font-medium leading-snug">{meeting.title}</p>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {today
          ? fmtDate(meeting.startAt, "h:mm a")
          : fmtDate(meeting.startAt, "MMM d · h:mm a")}
        {" · "}
        {meeting.attendeeName}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {LOCATION_LABEL[meeting.locationType]}
        </Badge>
        {meeting.attendeeEmail ? (
          <span className="truncate text-[11px] text-muted-foreground">{meeting.attendeeEmail}</span>
        ) : null}
      </div>
      {meeting.leadId ? (
        <Link
          href={`/leads/${meeting.leadId}`}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Open lead <ExternalLink className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

export function ActionBoardDetailDialog({
  open,
  onOpenChange,
  tasks,
  followups,
  meetings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: LeadTask[];
  followups: Followup[];
  meetings: Meeting[];
}) {
  const board = React.useMemo(
    () => buildActionBoard({ tasks, followups, meetings, limit: null }),
    [tasks, followups, meetings],
  );

  const meetingCount = board.todayMeetings.length + board.upcomingMeetings.length;
  const totalFocus =
    board.urgentTasks.length + board.overdueFollowups.length + board.pendingTasks.length + meetingCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "flex h-[min(92vh,56rem)] w-[min(98vw,80rem)] max-w-[min(98vw,80rem)] flex-col gap-0 overflow-hidden p-0",
          "sm:max-w-[min(98vw,80rem)]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-3 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base">Action board</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Full queue — {totalFocus} item{totalFocus === 1 ? "" : "s"} needing attention
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" render={<Link href="/tasks" />} nativeButton={false}>
                Tasks
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" render={<Link href="/followups" />} nativeButton={false}>
                Follow-ups
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" render={<Link href="/scheduling" />} nativeButton={false}>
                Scheduling
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatChip label="Urgent" count={board.urgentTasks.length} tone="danger" />
            <StatChip label="Overdue FUs" count={board.overdueFollowups.length} tone="warn" />
            <StatChip label="Pending" count={board.pendingTasks.length} tone="muted" />
            <StatChip label="Meetings" count={meetingCount} tone="info" />
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:p-5 lg:grid-cols-2 xl:grid-cols-4 xl:overflow-hidden">
          <Column
            title="Urgent tasks"
            icon={AlertTriangle}
            count={board.urgentTasks.length}
            empty="No overdue tasks"
            tone="danger"
          >
            {board.urgentTasks.map((t) => (
              <TaskRow key={t.id} task={t} urgent />
            ))}
          </Column>

          <Column
            title="Overdue follow-ups"
            icon={Clock}
            count={board.overdueFollowups.length}
            empty="None overdue"
            tone="warn"
          >
            {board.overdueFollowups.map((f) => (
              <FollowupRow key={f.id} followup={f} />
            ))}
          </Column>

          <Column
            title="Pending tasks"
            icon={CheckSquare}
            count={board.pendingTasks.length}
            empty="Queue clear"
          >
            {board.pendingTasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </Column>

          <Column
            title="Meetings"
            icon={Calendar}
            count={meetingCount}
            empty="No meetings lined up"
            tone="info"
          >
            {board.todayMeetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} today />
            ))}
            {board.upcomingMeetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} />
            ))}
          </Column>
        </div>
      </DialogContent>
    </Dialog>
  );
}
