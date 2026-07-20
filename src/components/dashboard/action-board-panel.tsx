"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Calendar, CheckSquare, Clock, Maximize2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionBoardDetailDialog } from "@/components/dashboard/action-board-detail-dialog";
import { buildActionBoard } from "@/lib/dashboard-ops-analytics";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Followup, LeadTask, Meeting } from "@/lib/types";

function Section({
  title,
  icon: Icon,
  children,
  empty,
  wall,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  empty: string;
  wall?: boolean;
}) {
  const hasKids = React.Children.count(children) > 0;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {title}
      </div>
      {hasKids ? (
        <ul className="space-y-1.5">{children}</ul>
      ) : (
        <p className={cn("text-muted-foreground", wall ? "text-sm" : "text-xs")}>{empty}</p>
      )}
    </div>
  );
}

export function ActionBoardPanel({
  tasks,
  followups,
  meetings,
  wall,
  className,
}: {
  tasks: LeadTask[];
  followups: Followup[];
  meetings: Meeting[];
  wall?: boolean;
  className?: string;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const board = React.useMemo(
    () => buildActionBoard({ tasks, followups, meetings }),
    [tasks, followups, meetings],
  );

  return (
    <>
      <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
        <CardHeader className={cn("pb-2", wall && "shrink-0")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
                Action board
              </CardTitle>
              <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
                Urgent work · pending tasks · meetings
              </CardDescription>
            </div>
            {!wall ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setDetailOpen(true)}
                aria-label="Open full action board"
                title="Open full action board"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-5 pt-0 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2",
            wall && "min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-1 xl:grid-cols-1 2xl:grid-cols-1",
          )}
        >
          <Section title="Urgent tasks" icon={AlertTriangle} empty="No overdue tasks" wall={wall}>
            {board.urgentTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.leadId ? `/leads/${t.leadId}` : "/tasks"}
                  className={cn(
                    "block rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5",
                    wall ? "text-sm" : "text-xs",
                    !wall && "hover:bg-destructive/10",
                  )}
                >
                  <span className="font-medium line-clamp-1">{t.title}</span>
                  {t.dueAt ? (
                    <span className="mt-0.5 block text-[10px] text-destructive">
                      Due {fmtRelative(t.dueAt)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </Section>

          <Section title="Pending tasks" icon={CheckSquare} empty="Queue clear" wall={wall}>
            {board.pendingTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.leadId ? `/leads/${t.leadId}` : "/tasks"}
                  className={cn(
                    "block rounded-md border px-2.5 py-1.5",
                    wall ? "text-sm" : "text-xs",
                    !wall && "hover:bg-muted/40",
                  )}
                >
                  <span className="line-clamp-1">{t.title}</span>
                  {t.dueAt ? (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {fmtDate(t.dueAt, "MMM d")}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </Section>

          <Section title="Overdue follow-ups" icon={Clock} empty="None overdue" wall={wall}>
            {board.overdueFollowups.map((f) => (
              <li key={f.id}>
                <Link
                  href={f.leadId ? `/leads/${f.leadId}` : "/followups"}
                  className={cn(
                    "block rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5",
                    wall ? "text-sm" : "text-xs",
                    !wall && "hover:bg-amber-500/10",
                  )}
                >
                  <span className="line-clamp-1 font-medium">{f.title}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    Due {fmtRelative(f.dueAt)}
                  </span>
                </Link>
              </li>
            ))}
          </Section>

          <Section title="Meetings" icon={Calendar} empty="No meetings lined up" wall={wall}>
            {board.todayMeetings.map((m) => (
              <li key={m.id}>
                <div
                  className={cn(
                    "rounded-md border border-chart-1/30 bg-chart-1/5 px-2.5 py-1.5",
                    wall ? "text-sm" : "text-xs",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      Today
                    </Badge>
                    <span className="line-clamp-1 font-medium">{m.title}</span>
                  </div>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {fmtDate(m.startAt, "h:mm a")} · {m.attendeeName}
                  </span>
                </div>
              </li>
            ))}
            {board.upcomingMeetings.map((m) => (
              <li key={m.id}>
                <div className={cn("rounded-md border px-2.5 py-1.5", wall ? "text-sm" : "text-xs")}>
                  <span className="line-clamp-1">{m.title}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {fmtDate(m.startAt, "MMM d · h:mm a")} · {m.attendeeName}
                  </span>
                </div>
              </li>
            ))}
          </Section>
        </CardContent>
      </Card>

      {!wall ? (
        <ActionBoardDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          tasks={tasks}
          followups={followups}
          meetings={meetings}
        />
      ) : null}
    </>
  );
}
