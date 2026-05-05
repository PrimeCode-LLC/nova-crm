"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Lead, LeadTask } from "@/lib/types";
import { fmtDate, fmtRelative } from "@/lib/format";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { NewLeadTaskDialog } from "@/components/tasks/new-lead-task-dialog";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<LeadTask["taskType"], string> = {
  review: "Review",
  email: "Email",
  call: "Call",
  document: "Document",
  other: "Other",
};

function TaskCard({
  task,
  viewerRole,
}: {
  task: LeadTask;
  viewerRole: "assignee" | "creator" | "observer";
}) {
  const { setLeadTaskCompleted } = useWorkspace();
  const dueSoon =
    task.dueAt &&
    !task.completedAt &&
    new Date(task.dueAt).getTime() < Date.now() + 86400000 * 3;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        task.completedAt && "opacity-70 bg-muted/30",
        dueSoon && !task.completedAt && "border-warning/40",
      )}
    >
      <div className="flex items-start gap-3">
        {(viewerRole === "assignee" || viewerRole === "creator") && (
          <Checkbox
            checked={Boolean(task.completedAt)}
            onCheckedChange={(v) => {
              if (v !== true && v !== false) return;
              setLeadTaskCompleted(task.id, v === true);
            }}
            aria-label={task.completedAt ? "Mark open" : "Mark done"}
            className="mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{task.title}</span>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {TYPE_LABEL[task.taskType]}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-normal capitalize">
              {task.visibility === "on_lead" ? "On lead" : "Private"}
            </Badge>
          </div>
          {task.description && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{task.description}</p>}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              For <UserChip userId={task.assigneeId} size="sm" />
            </span>
            <span>
              From <UserChip userId={task.createdById} size="sm" />
            </span>
            {task.dueAt && (
              <span className={dueSoon && !task.completedAt ? "text-warning font-medium" : undefined}>
                Due {fmtDate(task.dueAt)} ({fmtRelative(task.dueAt)})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LeadTasksPanel({ tasks, lead }: { tasks: LeadTask[]; lead: Lead }) {
  const { currentUserId, addLeadTask } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const openTasks = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Team tasks</p>
          <p className="text-xs text-muted-foreground">
            Only the <strong className="font-medium text-foreground">assignee</strong>,{" "}
            <strong className="font-medium text-foreground">who requested it</strong>, and{" "}
            <strong className="font-medium text-foreground">admins / directors</strong> can see these — not the rest of
            the org.
          </p>
        </div>
        <Button size="sm" type="button" onClick={() => setOpen(true)}>
          Assign task
        </Button>
      </div>

      {openTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open tasks for this lead.</p>
      ) : (
        <div className="space-y-2">
          {openTasks.map((t) => {
            let viewerRole: "assignee" | "creator" | "observer" = "observer";
            if (t.assigneeId === currentUserId) viewerRole = "assignee";
            else if (t.createdById === currentUserId) viewerRole = "creator";
            return <TaskCard key={t.id} task={t} viewerRole={viewerRole} />;
          })}
        </div>
      )}

      {done.length > 0 && (
        <details className="rounded-md border bg-muted/20 px-3 py-2">
          <summary className="text-xs font-medium cursor-pointer select-none">Completed ({done.length})</summary>
          <div className="mt-3 space-y-2">
            {done.map((t) => {
              let vr: "assignee" | "creator" | "observer" = "observer";
              if (t.assigneeId === currentUserId) vr = "assignee";
              else if (t.createdById === currentUserId) vr = "creator";
              return <TaskCard key={t.id} task={t} viewerRole={vr} />;
            })}
          </div>
        </details>
      )}

      <NewLeadTaskDialog
        open={open}
        onOpenChange={setOpen}
        leads={[lead]}
        currentUserId={currentUserId}
        fixedLeadId={lead.id}
        onCreate={addLeadTask}
      />
    </div>
  );
}
