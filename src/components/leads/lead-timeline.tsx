"use client";

import * as React from "react";
import {
  CirclePlus,
  CornerUpLeft,
  FileEdit,
  Mail,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  UserCog2,
  Workflow,
  CalendarCheck,
  CalendarClock,
  Handshake,
  type LucideIcon,
} from "lucide-react";
import type { TimelineEvent, TimelineEventType } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/common/user-chip";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS: Record<TimelineEventType, LucideIcon> = {
  lead_created: CirclePlus,
  stage_changed: Workflow,
  touchpoint_added: Mail,
  email_sent: Mail,
  email_replied: CornerUpLeft,
  note_added: NotebookPen,
  followup_created: CalendarClock,
  followup_completed: CalendarCheck,
  deal_created: Handshake,
  assignment_changed: UserCog2,
  field_changed: FileEdit,
};

const TONES: Record<TimelineEventType, string> = {
  lead_created: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  stage_changed: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  touchpoint_added: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  email_sent: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  email_replied: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  note_added: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  followup_created: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  followup_completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  deal_created: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  assignment_changed: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  field_changed: "bg-muted text-muted-foreground border-muted",
};

export function LeadTimeline({ events }: { events: TimelineEvent[] }) {
  const [note, setNote] = React.useState("");
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      {/* Quick composer */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <Textarea
          placeholder="Log a note, send an email, record a touchpoint…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-[72px] resize-none border-0 focus-visible:ring-0 p-0 shadow-none"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Mail className="h-3.5 w-3.5" /> Log email
          </Button>
          <Button variant="outline" size="sm">
            <MessageSquare className="h-3.5 w-3.5" /> LinkedIn
          </Button>
          <Button variant="outline" size="sm">
            <CalendarClock className="h-3.5 w-3.5" /> Followup
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="h-3.5 w-3.5" /> Stage
          </Button>
          <div className="ml-auto">
            <Button size="sm" disabled={!note.trim()}>
              <NotebookPen className="h-3.5 w-3.5" /> Add note
            </Button>
          </div>
        </div>
      </div>

      {/* Timeline */}
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
