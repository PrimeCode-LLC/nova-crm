"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, ListTodo, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/common/user-chip";
import { PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Followup, LeadTask, Role } from "@/lib/types";
import { showTeamFollowupsOnDashboard } from "@/lib/dashboard-role-focus";
import { isFollowupDueThroughToday, isFollowupOverdue } from "@/lib/followup-open-status";

/** Calendar-day buckets, aligned with Follow-ups / Needs Attention. */
function followupDueBucket(followup: Followup): "overdue" | "today" | "soon" | "later" {
  if (isFollowupOverdue(followup)) return "overdue";
  if (isFollowupDueThroughToday(followup)) return "today";
  const due = new Date(followup.dueAt).getTime();
  if (Number.isNaN(due)) return "later";
  if (due < Date.now() + 86_400_000 * 7) return "soon";
  return "later";
}

function followupHref(f: Followup): string {
  if (f.leadId) return `/leads/${f.leadId}`;
  if (f.dealId) return `/deals/${f.dealId}`;
  return "/followups";
}

function taskDueSoon(task: LeadTask): boolean {
  return Boolean(
    task.dueAt && !task.completedAt && new Date(task.dueAt).getTime() < Date.now() + 86_400_000 * 3,
  );
}

export function DashboardPendingOverview({
  roleId,
  followups,
  leadTasks,
  currentUserId,
  setFollowupCompleted,
  setLeadTaskCompleted,
}: {
  roleId: Role | undefined;
  followups: Followup[];
  leadTasks: LeadTask[];
  currentUserId: string;
  setFollowupCompleted: (id: string, completed: boolean) => void;
  setLeadTaskCompleted: (id: string, completed: boolean) => void;
}) {
  const open = followups.filter(
    (f) => !f.completedAt && !f.pausedAt && f.deliveryStatus !== "sent",
  );
  const mineFollowups = React.useMemo(
    () =>
      open
        .filter((f) => f.ownerId === currentUserId)
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
        .slice(0, 6),
    [open, currentUserId],
  );

  const teamFollowups = React.useMemo(() => {
    if (!showTeamFollowupsOnDashboard(roleId)) return [];
    return open
      .filter((f) => f.ownerId !== currentUserId)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, 5);
  }, [open, currentUserId, roleId]);

  const myOpenTasks = React.useMemo(
    () =>
      leadTasks
        .filter((t) => !t.completedAt && t.assigneeId === currentUserId)
        .sort((a, b) => {
          const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
          const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
          return ad - bd;
        })
        .slice(0, 6),
    [leadTasks, currentUserId],
  );

  const outgoingOpen = React.useMemo(
    () =>
      leadTasks
        .filter(
          (t) => !t.completedAt && t.createdById === currentUserId && t.assigneeId !== currentUserId,
        )
        .sort((a, b) => {
          const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
          const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
          return ad - bd;
        })
        .slice(0, 4),
    [leadTasks, currentUserId],
  );

  const mineTaskCount = leadTasks.filter((t) => !t.completedAt && t.assigneeId === currentUserId).length;
  const outgoingCount = leadTasks.filter(
    (t) => !t.completedAt && t.createdById === currentUserId && t.assigneeId !== currentUserId,
  ).length;

  if (
    mineFollowups.length === 0 &&
    teamFollowups.length === 0 &&
    myOpenTasks.length === 0 &&
    outgoingOpen.length === 0
  ) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(mineFollowups.length > 0 || teamFollowups.length > 0) && (
        <Card className="min-w-0">
          <CardHeader className="pb-3 space-y-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                  Follow-ups
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Open reminders on leads you can see. Due soonest first.
                </CardDescription>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 h-8 text-xs" nativeButton={false} render={<Link href="/followups" />}>
                All
                <ChevronRight className="h-3.5 w-3.5 ml-0.5" aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {mineFollowups.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Yours</p>
                <ul className="divide-y rounded-md border bg-card">
                  {mineFollowups.map((f) => (
                    <FollowupRow key={f.id} f={f} onToggle={setFollowupCompleted} canToggle />
                  ))}
                </ul>
              </div>
            )}
            {teamFollowups.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Team</p>
                <ul className="divide-y rounded-md border bg-muted/20">
                  {teamFollowups.map((f) => (
                    <FollowupRow key={f.id} f={f} onToggle={setFollowupCompleted} canToggle={false} />
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(myOpenTasks.length > 0 || outgoingOpen.length > 0) && (
        <Card className="min-w-0">
          <CardHeader className="pb-3 space-y-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                  Tasks
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {mineTaskCount > 0 && (
                    <span>
                      <span className="font-medium text-foreground">{mineTaskCount}</span> assigned to you
                    </span>
                  )}
                  {mineTaskCount > 0 && outgoingCount > 0 && <span> · </span>}
                  {outgoingCount > 0 && (
                    <span>
                      <span className="font-medium text-foreground">{outgoingCount}</span> waiting on others
                    </span>
                  )}
                  {mineTaskCount === 0 && outgoingCount === 0 && "Private team tasks in your workspace."}
                </CardDescription>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 h-8 text-xs" nativeButton={false} render={<Link href="/tasks" />}>
                All
                <ChevronRight className="h-3.5 w-3.5 ml-0.5" aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {myOpenTasks.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">For you</p>
                <ul className="divide-y rounded-md border bg-card">
                  {myOpenTasks.map((t) => (
                    <TaskCompactRow key={t.id} task={t} mode="assignee" setLeadTaskCompleted={setLeadTaskCompleted} />
                  ))}
                </ul>
              </div>
            )}
            {outgoingOpen.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">You requested</p>
                <ul className="divide-y rounded-md border bg-muted/20">
                  {outgoingOpen.map((t) => (
                    <TaskCompactRow key={t.id} task={t} mode="creator" setLeadTaskCompleted={setLeadTaskCompleted} />
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FollowupRow({
  f,
  onToggle,
  canToggle,
}: {
  f: Followup;
  onToggle: (id: string, completed: boolean) => void;
  canToggle: boolean;
}) {
  const bucket = followupDueBucket(f);
  const href = followupHref(f);
  const pr = PRIORITY_TONE[f.priority];

  return (
    <li className="flex gap-2 items-start px-3 py-2.5 text-sm">
      {canToggle ? (
        <Checkbox
          className="mt-0.5"
          checked={false}
          onCheckedChange={(v) => {
            if (v === true) onToggle(f.id, true);
          }}
          aria-label={`Mark done: ${f.title}`}
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium leading-snug">{f.title}</span>
          <Badge variant="secondary" className={cn("text-[10px] font-normal h-5 px-1.5", pr.className)}>
            {pr.label}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {!canToggle && <UserChip userId={f.ownerId} size="sm" />}
          <span
            className={cn(
              bucket === "overdue" && "text-destructive font-medium",
              bucket === "today" && "text-warning font-medium",
            )}
          >
            {fmtDate(f.dueAt)} · {fmtRelative(f.dueAt)}
          </span>
        </div>
        <Link href={href} className="text-xs text-primary inline-flex items-center gap-0.5 hover:underline">
          Open context
        </Link>
      </div>
    </li>
  );
}

function TaskCompactRow({
  task,
  mode,
  setLeadTaskCompleted,
}: {
  task: LeadTask;
  mode: "assignee" | "creator";
  setLeadTaskCompleted: (id: string, completed: boolean) => void;
}) {
  const leadHref = task.leadId ? `/leads/${task.leadId}?tab=tasks` : undefined;
  const dueSoon = taskDueSoon(task);

  return (
    <li className="flex gap-2 items-start px-3 py-2.5 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={false}
        onCheckedChange={(v) => {
          if (v === true || v === false) setLeadTaskCompleted(task.id, v === true);
        }}
        aria-label={`Mark done: ${task.title}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="font-medium leading-snug block">{task.title}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {mode === "creator" && (
            <span className="inline-flex items-center gap-1">
              Assignee <UserChip userId={task.assigneeId} size="sm" />
            </span>
          )}
          {task.contextCompany && <span>{task.contextCompany}</span>}
          {task.contextContact && <span>{task.contextContact}</span>}
          {task.dueAt && (
            <span className={cn(dueSoon && "text-warning font-medium")}>
              Due {fmtDate(task.dueAt)} · {fmtRelative(task.dueAt)}
            </span>
          )}
        </div>
        {leadHref && (
          <Link href={leadHref} className="text-xs text-primary inline-flex hover:underline">
            Open lead
          </Link>
        )}
      </div>
    </li>
  );
}
