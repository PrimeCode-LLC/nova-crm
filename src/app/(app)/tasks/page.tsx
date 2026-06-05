"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Plus } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { LeadTask } from "@/lib/types";
import { cn } from "@/lib/utils";

const NewLeadTaskDialog = dynamic(
  () => import("@/components/tasks/new-lead-task-dialog").then((m) => ({ default: m.NewLeadTaskDialog })),
  { ssr: false },
);

const TYPE_LABEL: Record<LeadTask["taskType"], string> = {
  review: "Review",
  email: "Email",
  call: "Call",
  document: "Document",
  other: "Other",
};

export default function TasksPage() {
  const ws = useWorkspace();
  const { leadTasks, leads, currentUserId, addLeadTask, setLeadTaskCompleted, isDemo } = ws;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"inbox" | "sent" | "all">("inbox");

  const openTasks = leadTasks.filter((t) => !t.completedAt);
  const mine = openTasks.filter((t) => t.assigneeId === currentUserId);
  const sent = openTasks.filter((t) => t.createdById === currentUserId);

  const visible =
    tab === "inbox" ? mine : tab === "sent" ? sent : openTasks;

  function viewerRole(t: LeadTask): "assignee" | "creator" | "observer" {
    if (t.assigneeId === currentUserId) return "assignee";
    if (t.createdById === currentUserId) return "creator";
    return "observer";
  }

  return (
    <>
      <PageHeader
        title="Team tasks"
        description="Only the assignee, the person who assigned the task, and org admins or directors can see these, not the rest of the team."
        actions={
          <Button size="sm" type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Assign task
          </Button>
        }
      />
      <PageBody>
        {!isDemo && leadTasks.length === 0 ? (
          <WorkspaceEmptyHint title="No tasks yet" description="Create one to ping someone on your team." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="Assigned to me" value={mine.length} highlight={mine.length > 0} />
              <StatCard label="Waiting on others" value={sent.filter((t) => t.assigneeId !== currentUserId).length} />
              <StatCard label="Open (total)" value={openTasks.length} />
              <StatCard label="Done (all time)" value={leadTasks.filter((t) => t.completedAt).length} muted />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="inbox">
                  For me
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {mine.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="sent">
                  I requested
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {sent.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="all">
                  All open
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {openTasks.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value={tab} className="mt-4 space-y-3">
                {visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Nothing here.</p>
                ) : (
                  visible.map((t) => (
                    <TaskRow key={t.id} task={t} role={viewerRole(t)} setLeadTaskCompleted={setLeadTaskCompleted} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </>
        )}

        {dialogOpen ? (
          <NewLeadTaskDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            leads={leads}
            currentUserId={currentUserId}
            onCreate={addLeadTask}
          />
        ) : null}
      </PageBody>
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex flex-col gap-1",
        highlight && "border-primary/30 bg-primary/5",
        muted && "opacity-90",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function TaskRow({
  task,
  role,
  setLeadTaskCompleted,
}: {
  task: LeadTask;
  role: "assignee" | "creator" | "observer";
  setLeadTaskCompleted: (id: string, completed: boolean) => void;
}) {
  const leadHref = task.leadId ? `/leads/${task.leadId}?tab=tasks` : undefined;
  const dueSoon =
    task.dueAt &&
    !task.completedAt &&
    new Date(task.dueAt).getTime() < Date.now() + 86400000 * 3;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex gap-3",
        task.completedAt && "opacity-70",
        dueSoon && !task.completedAt && "border-warning/35",
      )}
    >
      {(role === "assignee" || role === "creator") && (
        <Checkbox
          checked={Boolean(task.completedAt)}
          onCheckedChange={(v) => {
            if (v !== true && v !== false) return;
            setLeadTaskCompleted(task.id, v === true);
          }}
          className="mt-1"
          aria-label="Done"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{task.title}</span>
          <Badge variant="secondary" className="text-[10px] font-normal">
            {TYPE_LABEL[task.taskType]}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-normal capitalize">
            {task.visibility === "on_lead" ? "On lead" : "Private"}
          </Badge>
        </div>
        {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            Assignee <UserChip userId={task.assigneeId} size="sm" />
          </span>
          <span className="flex items-center gap-1">
            From <UserChip userId={task.createdById} size="sm" />
          </span>
          {task.contextCompany && <span>{task.contextCompany}</span>}
          {task.dueAt && (
            <span className={dueSoon ? "text-warning font-medium" : undefined}>
              Due {fmtDate(task.dueAt)} · {fmtRelative(task.dueAt)}
            </span>
          )}
        </div>
        {leadHref && (
          <Link href={leadHref} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
            Open lead
          </Link>
        )}
      </div>
    </div>
  );
}
