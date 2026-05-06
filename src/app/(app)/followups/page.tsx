"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/common/kpi-card";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { NewFollowupDialog } from "@/components/followups/new-followup-dialog";
import { PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Followup, Lead } from "@/lib/types";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function categorize(dueAt: string) {
  const d = new Date(dueAt);
  const now = Date.now();
  const diff = d.getTime() - now;
  const day = 86400_000;
  if (diff < 0) return "overdue";
  if (diff < day) return "today";
  if (diff < day * 7) return "thisWeek";
  return "later";
}

type BucketFilter = "all" | "overdue" | "today" | "thisWeek";

export default function FollowupsPage() {
  const router = useRouter();
  const ws = useWorkspace();
  const { followups, isDemo, leads, users, currentUserId, addFollowup, setFollowupCompleted, removeFollowup } =
    ws;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"open" | "completed">("open");
  const [bucketFilter, setBucketFilter] = React.useState<BucketFilter>("all");
  const [deleteTarget, setDeleteTarget] = React.useState<Followup | null>(null);

  const canDeleteFollowups =
    !isDemo && viewerHasElevatedWorkspaceRole(users.find((u) => u.id === currentUserId));

  const open = followups.filter((f) => !f.completedAt);
  const done = followups.filter((f) => f.completedAt);

  const overdue = open.filter((f) => categorize(f.dueAt) === "overdue");
  const today = open.filter((f) => categorize(f.dueAt) === "today");
  const thisWeek = open.filter((f) => categorize(f.dueAt) === "thisWeek");
  const later = open.filter((f) => categorize(f.dueAt) === "later");

  function toggleBucket(next: BucketFilter) {
    setTab("open");
    setBucketFilter((prev) => (prev === next ? "all" : next));
  }

  function scrollToBucket(b: Exclude<BucketFilter, "all">) {
    const id =
      b === "overdue"
        ? "followups-bucket-overdue"
        : b === "today"
          ? "followups-bucket-today"
          : "followups-bucket-week";
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleKpiOverdue() {
    toggleBucket("overdue");
    queueMicrotask(() => scrollToBucket("overdue"));
  }

  function handleKpiToday() {
    toggleBucket("today");
    queueMicrotask(() => scrollToBucket("today"));
  }

  function handleKpiThisWeek() {
    toggleBucket("thisWeek");
    queueMicrotask(() => scrollToBucket("thisWeek"));
  }

  function handleKpiCompleted() {
    setTab("completed");
    setBucketFilter("all");
  }

  const showGroup = (bucket: BucketFilter) => bucketFilter === "all" || bucketFilter === bucket;

  const confirmDeleteFollowup = React.useCallback(() => {
    if (!deleteTarget) return;
    removeFollowup(deleteTarget.id);
    toast.success("Followup deleted");
    setDeleteTarget(null);
  }, [deleteTarget, removeFollowup]);

  return (
    <>
      <PageHeader
        title="Followups"
        description="Your tasks and reminders, including auto-generated idle warnings."
        actions={
          <Button size="sm" type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New followup
          </Button>
        }
      />
      <PageBody>
        {!isDemo && followups.length === 0 ? (
          <WorkspaceEmptyHint title="No followups in workspace" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                label="Overdue"
                value={overdue.length}
                icon={AlertTriangle}
                onClick={handleKpiOverdue}
                selected={tab === "open" && bucketFilter === "overdue"}
              />
              <KpiCard
                label="Due today"
                value={today.length}
                icon={Clock}
                onClick={handleKpiToday}
                selected={tab === "open" && bucketFilter === "today"}
              />
              <KpiCard
                label="This week"
                value={thisWeek.length}
                icon={CalendarClock}
                onClick={handleKpiThisWeek}
                selected={tab === "open" && bucketFilter === "thisWeek"}
              />
              <KpiCard
                label="Completed"
                value={done.length}
                icon={CheckCircle2}
                onClick={handleKpiCompleted}
                selected={tab === "completed"}
              />
            </div>

            <Tabs
              value={tab}
              onValueChange={(v) => {
                const next = v as "open" | "completed";
                setTab(next);
                if (next === "completed") setBucketFilter("all");
              }}
              className="mt-4"
            >
              <TabsList>
                <TabsTrigger value="open">
                  Open
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {open.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {done.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="open" className="mt-4 space-y-4">
                {bucketFilter !== "all" && (
                  <p className="text-xs text-muted-foreground">
                    Showing{" "}
                    {bucketFilter === "overdue"
                      ? "overdue"
                      : bucketFilter === "today"
                        ? "due today"
                        : "this week"}{" "}
                    only. Click the same summary card again to show all open followups.
                  </p>
                )}
                {showGroup("overdue") && (
                  <div id="followups-bucket-overdue">
                    <FollowupGroup
                      title="Overdue"
                      description="Past due (highest priority)."
                      tone="rose"
                      items={overdue}
                      empty="Nothing overdue. Nice."
                      getLeadById={ws.getLeadById}
                      onToggleComplete={setFollowupCompleted}
                      onRowNavigate={(leadId) => router.push(`/leads/${leadId}`)}
                      canDelete={canDeleteFollowups}
                      onRequestDelete={setDeleteTarget}
                    />
                  </div>
                )}
                {showGroup("today") && (
                  <div id="followups-bucket-today">
                    <FollowupGroup
                      title="Due today"
                      description="Let's knock these out today."
                      tone="amber"
                      items={today}
                      empty="Nothing due today."
                      getLeadById={ws.getLeadById}
                      onToggleComplete={setFollowupCompleted}
                      onRowNavigate={(leadId) => router.push(`/leads/${leadId}`)}
                      canDelete={canDeleteFollowups}
                      onRequestDelete={setDeleteTarget}
                    />
                  </div>
                )}
                {showGroup("thisWeek") && (
                  <div id="followups-bucket-week">
                    <FollowupGroup
                      title="This week"
                      description="Coming up in the next 7 days."
                      tone="neutral"
                      items={thisWeek}
                      empty="No followups this week."
                      getLeadById={ws.getLeadById}
                      onToggleComplete={setFollowupCompleted}
                      onRowNavigate={(leadId) => router.push(`/leads/${leadId}`)}
                      canDelete={canDeleteFollowups}
                      onRequestDelete={setDeleteTarget}
                    />
                  </div>
                )}
                {bucketFilter === "all" && (
                  <div id="followups-bucket-later">
                    <FollowupGroup
                      title="Later"
                      description="Scheduled further out."
                      tone="neutral"
                      items={later}
                      empty="Nothing scheduled further out."
                      getLeadById={ws.getLeadById}
                      onToggleComplete={setFollowupCompleted}
                      onRowNavigate={(leadId) => router.push(`/leads/${leadId}`)}
                      canDelete={canDeleteFollowups}
                      onRequestDelete={setDeleteTarget}
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="completed" className="mt-4">
                <Card>
                  <CardContent className="p-0 divide-y">
                    {done.map((f) => {
                      const lead = f.leadId ? ws.getLeadById(f.leadId) : undefined;
                      return (
                        <div
                          key={f.id}
                          role={lead ? "button" : undefined}
                          tabIndex={lead ? 0 : undefined}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2 opacity-90",
                            lead && "cursor-pointer hover:bg-muted/50",
                          )}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("[data-slot=checkbox], [data-followup-delete]"))
                              return;
                            if (lead) router.push(`/leads/${lead.id}`);
                          }}
                          onKeyDown={(e) => {
                            if (!lead) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(`/leads/${lead.id}`);
                            }
                          }}
                        >
                          <Checkbox
                            checked
                            onCheckedChange={(v) => {
                              if (v !== true) setFollowupCompleted(f.id, false);
                            }}
                            aria-label={`Mark ${f.title} as not done`}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm line-through truncate block">{f.title}</span>
                            {lead && (
                              <Link
                                href={`/leads/${lead.id}`}
                                className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {lead.contactName} · {lead.companyName}
                              </Link>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {fmtRelative(f.completedAt)}
                          </span>
                          {canDeleteFollowups ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              data-followup-delete
                              aria-label="Delete followup"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(f);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                    {done.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        Nothing completed yet.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </PageBody>

      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this followup?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the reminder for everyone in the workspace. Linked lead activity is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteFollowup}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewFollowupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leads={leads}
        currentUserId={currentUserId}
        onCreate={addFollowup}
      />
    </>
  );
}

function FollowupGroup({
  title,
  description,
  tone,
  items,
  empty,
  getLeadById,
  onToggleComplete,
  onRowNavigate,
  canDelete,
  onRequestDelete,
}: {
  title: string;
  description: string;
  tone: "rose" | "amber" | "neutral";
  items: Followup[];
  empty: string;
  getLeadById: (id: string) => Lead | undefined;
  onToggleComplete: (id: string, completed: boolean) => void;
  onRowNavigate: (leadId: string) => void;
  canDelete: boolean;
  onRequestDelete: (f: Followup) => void;
}) {
  const toneRing =
    tone === "rose"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "amber"
        ? "border-warning/30 bg-warning/5"
        : "";

  return (
    <Card className={cn(toneRing)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">
              {title}
              <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">
                {items.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((f) => {
              const lead = f.leadId ? getLeadById(f.leadId) : undefined;
              const done = Boolean(f.completedAt);
              return (
                <li
                  key={f.id}
                  className={cn(
                    "flex items-center gap-3 py-2.5 -mx-1 px-1 rounded-md transition-colors",
                    lead && "cursor-pointer hover:bg-muted/40",
                  )}
                  role={lead ? "button" : undefined}
                  tabIndex={lead ? 0 : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-slot=checkbox], a, [data-followup-delete]"))
                      return;
                    if (f.leadId) onRowNavigate(f.leadId);
                  }}
                  onKeyDown={(e) => {
                    if (!f.leadId) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowNavigate(f.leadId);
                    }
                  }}
                >
                  <Checkbox
                    checked={done}
                    onCheckedChange={(v) => onToggleComplete(f.id, v === true)}
                    aria-label={done ? `Mark ${f.title} incomplete` : `Mark ${f.title} complete`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{f.title}</span>
                      <Badge
                        className={cn(
                          "rounded-md border-transparent text-[10px]",
                          PRIORITY_TONE[f.priority].className,
                        )}
                      >
                        {PRIORITY_TONE[f.priority].label}
                      </Badge>
                      {f.auto && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Sparkles className="h-2.5 w-2.5" /> Auto
                        </Badge>
                      )}
                    </div>
                    {lead && (
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {lead.contactName} · {lead.companyName}
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <UserChip userId={f.ownerId} size="xs" nameOnly />
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {fmtDate(f.dueAt, "MMM d")} · {fmtRelative(f.dueAt)}
                    </span>
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        data-followup-delete
                        aria-label="Delete followup"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDelete(f);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
