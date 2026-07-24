"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CirclePlus,
  CornerUpLeft,
  FileEdit,
  Mail,
  MailWarning,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  UserCog2,
  Workflow,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ListChecks,
  ListTodo,
  Handshake,
  Sparkles,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { Lead, TimelineEvent, TimelineEventType, User } from "@/lib/types";
import { leadTaskTimelineEventVisible } from "@/lib/lead-task-visibility";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/common/user-chip";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { LeadStageDialog } from "@/components/leads/lead-stage-dialog";
import { NewFollowupDialog } from "@/components/followups/new-followup-dialog";

const ICONS: Record<TimelineEventType, LucideIcon> = {
  lead_created: CirclePlus,
  stage_changed: Workflow,
  touchpoint_added: Mail,
  email_sent: Mail,
  email_replied: CornerUpLeft,
  email_bounced: MailWarning,
  note_added: NotebookPen,
  followup_created: CalendarClock,
  followup_completed: CalendarCheck,
  followup_plan_paused: CalendarClock,
  followup_plan_resumed: CalendarCheck,
  followup_sequence_rerouted: Mail,
  lead_task_created: ListTodo,
  lead_task_completed: ListChecks,
  deal_created: Handshake,
  assignment_changed: UserCog2,
  field_changed: FileEdit,
  ai_analysis: Sparkles,
  meeting_scheduled: CalendarClock,
  meeting_completed: CalendarCheck,
  meeting_cancelled: CalendarX,
  prospect_channel_pushed: ArrowUpRight,
};

const TONES: Record<TimelineEventType, string> = {
  lead_created: "bg-info/10 text-info border-info/20",
  stage_changed: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  touchpoint_added: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  email_sent: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  email_replied: "bg-success/10 text-success border-success/20",
  email_bounced: "bg-destructive/10 text-destructive border-destructive/20",
  note_added: "bg-warning/10 text-warning border-warning/20",
  followup_created: "bg-warning/10 text-warning border-warning/20",
  followup_completed: "bg-success/10 text-success border-success/20",
  followup_plan_paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  followup_plan_resumed: "bg-success/10 text-success border-success/20",
  followup_sequence_rerouted: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  lead_task_created: "bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/20",
  lead_task_completed: "bg-success/10 text-success border-success/20",
  deal_created: "bg-success/10 text-success border-success/20",
  assignment_changed: "bg-info/10 text-info border-info/20",
  field_changed: "bg-muted text-muted-foreground border-muted",
  ai_analysis: "bg-primary/10 text-primary border-primary/20",
  meeting_scheduled: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  meeting_completed: "bg-success/10 text-success border-success/20",
  meeting_cancelled: "bg-muted text-muted-foreground border-muted",
  prospect_channel_pushed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
};

function newTeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `te-local-${crypto.randomUUID()}`;
  }
  return `te-local-${Date.now()}`;
}

export function LeadTimeline({
  events,
  lead,
  viewerForTasks,
}: {
  events: TimelineEvent[];
  lead: Lead;
  viewerForTasks: User;
}) {
  const [note, setNote] = React.useState("");
  const [stageOpen, setStageOpen] = React.useState(false);
  const [followupOpen, setFollowupOpen] = React.useState(false);
  const {
    addLeadNote,
    addTimelineEvent,
    updateLeadStage,
    bumpLeadActivity,
    currentUserId,
    leads,
    leadTasks,
    addFollowup,
    canEditLead,
  } = useWorkspace();
  const visibleEvents = React.useMemo(
    () => events.filter((e) => leadTaskTimelineEventVisible(e, viewerForTasks, leadTasks)),
    [events, viewerForTasks, leadTasks],
  );
  const sorted = [...visibleEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function appendNoteFromComposer() {
    const t = note.trim();
    if (!t) return;
    addLeadNote(lead.id, t, currentUserId);
    setNote("");
    toast.success("Note added to timeline");
  }

  function logEmail() {
    const iso = new Date().toISOString();
    addTimelineEvent({
      id: newTeId(),
      leadId: lead.id,
      type: "email_sent",
      actorId: currentUserId,
      summary: "Outbound email logged (manual)",
      createdAt: iso,
    });
    bumpLeadActivity(lead.id);
    toast.success("Email logged on timeline");
  }

  function logLinkedIn() {
    const iso = new Date().toISOString();
    addTimelineEvent({
      id: newTeId(),
      leadId: lead.id,
      type: "touchpoint_added",
      actorId: currentUserId,
      summary: "LinkedIn activity logged",
      createdAt: iso,
    });
    bumpLeadActivity(lead.id);
    toast.success("LinkedIn touch logged");
  }

  function openFollowup() {
    setFollowupOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <Textarea
          placeholder="Log a note, send an email, record a touchpoint…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-[72px] resize-none border-0 focus-visible:ring-0 p-0 shadow-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" type="button" onClick={logEmail}>
            <Mail className="h-3.5 w-3.5" /> Log email
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={logLinkedIn}>
            <MessageSquare className="h-3.5 w-3.5" /> LinkedIn
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={openFollowup}>
            <CalendarClock className="h-3.5 w-3.5" /> Followup
          </Button>
          {canEditLead(lead) ? (
            <Button variant="outline" size="sm" type="button" onClick={() => setStageOpen(true)}>
              <RefreshCw className="h-3.5 w-3.5" /> Stage
            </Button>
          ) : null}
          <div className="ml-auto">
            <Button size="sm" disabled={!note.trim()} type="button" onClick={appendNoteFromComposer}>
              <NotebookPen className="h-3.5 w-3.5" /> Add note
            </Button>
          </div>
        </div>
      </div>

      <LeadStageDialog
        open={stageOpen}
        onOpenChange={setStageOpen}
        currentStage={lead.stage}
        contactName={lead.contactName}
        onConfirm={(next) => {
          if (next === lead.stage) return;
          updateLeadStage(lead.id, next, lead.stage, currentUserId);
          toast.success("Stage updated");
        }}
      />

      <NewFollowupDialog
        open={followupOpen}
        onOpenChange={setFollowupOpen}
        leads={leads}
        currentUserId={currentUserId}
        fixedLeadId={lead.id}
        onCreate={addFollowup}
      />

      <div className="relative pl-6">
        <div className="absolute left-[11px] top-1 bottom-1 w-px bg-border" />
        <div className="space-y-4">
          {sorted.map((e) => {
            const Icon = ICONS[e.type];
            const tone = TONES[e.type];
            return (
              <div key={e.id} className="relative">
                <div
                  className={cn(
                    "absolute -left-6 top-0.5 grid h-6 w-6 place-items-center rounded-full border bg-background",
                    tone,
                  )}
                >
                  <Icon className="h-3 w-3" />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm leading-snug">{e.summary}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {e.actorId && <UserChip userId={e.actorId} size="xs" />}
                      <span>·</span>
                      <time title={fmtDate(e.createdAt, "PPpp")}>{fmtRelative(e.createdAt)}</time>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet on this lead.</p>
          )}
        </div>
      </div>
    </div>
  );
}
