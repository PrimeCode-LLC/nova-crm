"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Calendar, CheckSquare, Clock, Maximize2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/common/user-chip";
import { ActionBoardDetailDialog } from "@/components/dashboard/action-board-detail-dialog";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { peekCrmEntity } from "@/lib/crm/entity-cache";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { useCachedLeadIds, useRememberLeadsByIds } from "@/hooks/use-snapshot-crm";
import { buildActionBoard } from "@/lib/dashboard-ops-analytics";
import { fmtDate, fmtRelative } from "@/lib/format";
import { contactFirstName } from "@/lib/leads/lead-display-label";
import { cn } from "@/lib/utils";
import type { Followup, Lead, LeadTask, Meeting } from "@/lib/types";

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

function personForTask(task: LeadTask, leadById: Map<string, Lead>): string | undefined {
  const fromContext = contactFirstName(task.contextContact);
  if (fromContext) return fromContext;
  if (!task.leadId) return undefined;
  return contactFirstName(leadById.get(task.leadId)?.contactName);
}

function personForFollowup(followup: Followup, leadById: Map<string, Lead>): string | undefined {
  if (!followup.leadId) return undefined;
  return contactFirstName(leadById.get(followup.leadId)?.contactName);
}

function ownerIdForLead(leadId: string | undefined, leadById: Map<string, Lead>, fallback?: string) {
  const fromLead = leadId ? leadById.get(leadId)?.ownerId?.trim() : undefined;
  if (fromLead) return fromLead;
  const fromFallback = fallback?.trim();
  return fromFallback || undefined;
}

function metaLine(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

function RowMeta({
  ownerId,
  meta,
  tone,
}: {
  ownerId?: string;
  meta?: string;
  tone?: "danger" | "muted";
}) {
  if (!ownerId && !meta) return null;
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
      {ownerId ? <UserChip userId={ownerId} size="xs" className="min-w-0 max-w-[8.5rem] shrink" /> : null}
      {meta ? (
        <span
          className={cn(
            "min-w-0 truncate text-[10px]",
            tone === "danger" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {meta}
        </span>
      ) : null}
    </div>
  );
}

export function ActionBoardPanel({
  tasks,
  followups,
  meetings,
  leads = [],
  wall,
  className,
  title = "Action board",
  description = "Urgent work · pending tasks · meetings",
}: {
  tasks: LeadTask[];
  followups: Followup[];
  meetings: Meeting[];
  leads?: readonly Lead[];
  wall?: boolean;
  className?: string;
  title?: string;
  description?: string;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const timeZone = useOrgTimezone();
  const { isDemo } = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(isDemo);
  const resolveNames = snapshotOff && leads.length === 0;
  const nameLeadIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const task of tasks) if (task.leadId) ids.push(task.leadId);
    for (const followup of followups) if (followup.leadId) ids.push(followup.leadId);
    return ids;
  }, [tasks, followups]);
  useRememberLeadsByIds(nameLeadIds, resolveNames);
  const cachedNameIds = useCachedLeadIds(resolveNames ? nameLeadIds : []);
  const board = React.useMemo(
    () => buildActionBoard({ tasks, followups, meetings, timeZone }),
    [tasks, followups, meetings, timeZone],
  );
  const resolvedLeads = React.useMemo(() => {
    if (!resolveNames) return leads;
    const out: Lead[] = [];
    for (const id of cachedNameIds.split(",")) {
      if (!id) continue;
      const lead = peekCrmEntity("leads", id);
      if (lead) out.push(lead);
    }
    return out;
  }, [resolveNames, leads, cachedNameIds]);
  const leadById = React.useMemo(
    () => new Map(resolvedLeads.map((lead) => [lead.id, lead])),
    [resolvedLeads],
  );

  return (
    <>
      <Card className={cn("min-w-0", wall && "flex h-full min-h-0 flex-col", className)}>
        <CardHeader className={cn("pb-2", wall && "shrink-0")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
                {title}
              </CardTitle>
              <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
                {description}
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
            {board.urgentTasks.map((t) => {
              const person = personForTask(t, leadById);
              const ownerId = ownerIdForLead(t.leadId, leadById, t.assigneeId);
              const meta = metaLine([person, t.dueAt ? `Due ${fmtRelative(t.dueAt)}` : undefined]);
              return (
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
                    <RowMeta ownerId={ownerId} meta={meta} tone="danger" />
                  </Link>
                </li>
              );
            })}
          </Section>

          <Section title="Pending tasks" icon={CheckSquare} empty="Queue clear" wall={wall}>
            {board.pendingTasks.map((t) => {
              const person = personForTask(t, leadById);
              const ownerId = ownerIdForLead(t.leadId, leadById, t.assigneeId);
              const meta = metaLine([person, t.dueAt ? fmtDate(t.dueAt, "MMM d") : undefined]);
              return (
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
                    <RowMeta ownerId={ownerId} meta={meta} />
                  </Link>
                </li>
              );
            })}
          </Section>

          <Section title="Overdue follow-ups" icon={Clock} empty="None overdue" wall={wall}>
            {board.overdueFollowups.map((f) => {
              const person = personForFollowup(f, leadById);
              const ownerId = ownerIdForLead(f.leadId, leadById, f.ownerId);
              const meta = metaLine([person, `Due ${fmtRelative(f.dueAt)}`]);
              return (
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
                    <RowMeta ownerId={ownerId} meta={meta} />
                  </Link>
                </li>
              );
            })}
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
                  {m.leadOwnerId || m.hostId ? (
                    <RowMeta ownerId={m.leadOwnerId || m.hostId} />
                  ) : null}
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
                  {m.leadOwnerId || m.hostId ? (
                    <RowMeta ownerId={m.leadOwnerId || m.hostId} />
                  ) : null}
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
          leads={resolvedLeads}
        />
      ) : null}
    </>
  );
}
