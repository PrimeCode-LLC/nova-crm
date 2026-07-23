"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Clapperboard, MailWarning, MessageSquareReply, Timer, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserChip } from "@/components/common/user-chip";
import { cn } from "@/lib/utils";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";
import {
  CONTENT_OPEN_STATUSES,
  type ContentItem,
} from "@/lib/content-calendar/types";
import { contactFirstName, leadEntityLabel } from "@/lib/leads/lead-display-label";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";

type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  time: number;
  severity: "urgent" | "warning" | "info";
  icon: typeof AlertTriangle;
  /** Sales owner for the related lead (or follow-up owner when unlinked). */
  ownerId?: string;
};

function withPerson(detail: string, lead: Lead | undefined): string {
  const company = lead?.companyName?.trim();
  const person = contactFirstName(lead?.contactName);
  // Only prefix the person when the primary label is the company (avoid "Jordan · Jordan").
  if (!person || !company) return detail;
  return `${person} · ${detail}`;
}

function entityWithPerson(lead: Lead): string {
  const company = lead.companyName?.trim();
  const person = contactFirstName(lead.contactName);
  if (company && person) return `${company} · ${person}`;
  return company || lead.contactName || "Untitled";
}

function resolveOwnerId(lead: Lead | undefined, fallback?: string): string | undefined {
  const fromLead = lead?.ownerId?.trim();
  if (fromLead) return fromLead;
  const fromFallback = fallback?.trim();
  return fromFallback || undefined;
}

function timestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function DashboardNeedsAttention({
  leads,
  followups,
  plans,
  tasks,
  contentItems,
  currentUserId,
  wall,
  className,
}: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  /** Optional overdue content calendar posts for the current user. */
  contentItems?: readonly ContentItem[];
  currentUserId: string;
  wall?: boolean;
  className?: string;
}) {
  const [now] = React.useState(() => Date.now());
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const leadFor = (leadId: string | undefined) => (leadId ? leadById.get(leadId) : undefined);
  const leadLabel = (leadId: string | undefined) => leadEntityLabel(leadFor(leadId));

  const items: AttentionItem[] = [];

  for (const content of contentItems ?? []) {
    if (!CONTENT_OPEN_STATUSES.includes(content.status)) continue;
    if (content.assigneeUserId !== currentUserId && content.ownerUserId !== currentUserId) continue;
    const due = timestamp(content.dueAt, Number.POSITIVE_INFINITY);
    if (due >= now) continue;
    items.push({
      id: `content-${content.id}`,
      label: `Overdue content · ${content.title}`,
      detail: content.angle.slice(0, 120),
      href: `/content/${content.id}`,
      time: due,
      severity: "warning",
      icon: Clapperboard,
      ownerId: content.assigneeUserId || content.ownerUserId,
    });
  }

  for (const lead of leads) {
    if (!hasPendingReplyReview(lead)) continue;
    items.push({
      id: `reply-${lead.id}`,
      label: `Reply to review · ${entityWithPerson(lead)}`,
      detail:
        lead.intakeKind === "prospect"
          ? "Promote to lead or confirm Replied on the dashboard."
          : "Confirm moving this opportunity to Replied.",
      href: lead.intakeKind === "prospect" ? `/leads/${lead.id}?from=prospects` : `/leads/${lead.id}`,
      time: timestamp(lead.lastReplyAt || lead.lastActivityAt, now),
      severity: "urgent",
      icon: MessageSquareReply,
      ownerId: resolveOwnerId(lead),
    });
  }

  for (const followup of followups) {
    if (followup.completedAt || followup.pausedAt) continue;
    const lead = leadFor(followup.leadId);
    const ownerId = resolveOwnerId(lead, followup.ownerId);
    if (followup.deliveryStatus === "failed") {
      items.push({
        id: `failed-${followup.id}`,
        label: `Email failed · ${leadLabel(followup.leadId)}`,
        detail: withPerson(followup.deliveryError || followup.title, lead),
        href: followup.leadId ? `/leads/${followup.leadId}` : "/followups",
        time: timestamp(followup.failedAt, now),
        severity: "urgent",
        icon: MailWarning,
        ownerId,
      });
      continue;
    }
    if (followup.deliveryStatus === "needs_retry") {
      items.push({
        id: `retry-${followup.id}`,
        label: `Email retrying · ${leadLabel(followup.leadId)}`,
        detail: withPerson(followup.deliveryError || followup.title, lead),
        href: followup.leadId ? `/leads/${followup.leadId}` : "/followups",
        time: timestamp(followup.nextRetryAt || followup.failedAt, now),
        severity: "warning",
        icon: MailWarning,
        ownerId,
      });
      continue;
    }
    const due = timestamp(followup.dueAt, Number.POSITIVE_INFINITY);
    if (due < now) {
      items.push({
        id: `followup-${followup.id}`,
        label: `Overdue follow-up · ${leadLabel(followup.leadId)}`,
        detail: withPerson(followup.title, lead),
        href: followup.leadId ? `/leads/${followup.leadId}` : "/followups",
        time: due,
        severity: "warning",
        icon: Timer,
        ownerId,
      });
    }
  }

  for (const task of tasks) {
    if (task.completedAt || task.assigneeId !== currentUserId || !task.dueAt) continue;
    const due = timestamp(task.dueAt, Number.POSITIVE_INFINITY);
    if (due >= now) continue;
    const lead = leadFor(task.leadId);
    const person =
      contactFirstName(task.contextContact) ||
      (lead?.companyName?.trim() ? contactFirstName(lead.contactName) : undefined);
    items.push({
      id: `task-${task.id}`,
      label: `Overdue task · ${task.contextCompany || leadLabel(task.leadId)}`,
      detail: person ? `${person} · ${task.title}` : task.title,
      href: "/tasks",
      time: due,
      severity: "warning",
      icon: ListTodo,
      ownerId: resolveOwnerId(lead, task.assigneeId),
    });
  }

  for (const plan of plans) {
    if (plan.status !== "paused" || !plan.replyMessageId) continue;
    const planLead = leadById.get(plan.leadId);
    if (planLead && hasPendingReplyReview(planLead)) continue;
    items.push({
      id: `plan-${plan.id}`,
      label: `Sequence stopped on reply · ${leadLabel(plan.leadId)}`,
      detail: withPerson(
        plan.pausedReason || "Review the response before continuing outreach.",
        planLead,
      ),
      href: `/leads/${plan.leadId}`,
      time: timestamp(plan.pausedAt, now),
      severity: "info",
      icon: MessageSquareReply,
      ownerId: resolveOwnerId(planLead, plan.ownerId),
    });
  }

  for (const lead of leads) {
    if (lead.intakeKind === "prospect" || !lead.isIdle || ["won", "lost"].includes(lead.stage)) continue;
    if (hasPendingReplyReview(lead)) continue;
    items.push({
      id: `idle-${lead.id}`,
      label: `Idle lead · ${entityWithPerson(lead)}`,
      detail: lead.idleDays ? `No activity for ${lead.idleDays} days` : "No recent activity",
      href: `/leads/${lead.id}`,
      time: timestamp(lead.lastActivityAt || lead.updatedAt, now),
      severity: "info",
      icon: AlertTriangle,
      ownerId: resolveOwnerId(lead),
    });
  }

  const severityRank = { urgent: 0, warning: 1, info: 2 };
  const limit = wall ? 6 : 8;
  const visible = items
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.time - b.time)
    .slice(0, limit);

  return (
    <Card className={cn("min-h-0 shrink-0", wall && "flex h-full flex-col", className)}>
      <CardHeader className={cn("pb-3", wall && "shrink-0")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription className="mt-1">
              Exceptions and work that should be handled next.
            </CardDescription>
          </div>
          {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", wall && "min-h-0 flex-1 overflow-y-auto")}>
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {visible.map((item) => {
              const Icon = item.icon;
              const rowClass = cn(
                "flex items-center gap-3 px-3 py-2.5",
                !wall && "transition-colors hover:bg-muted/40",
              );
              const body = (
                <>
                  <Icon
                    className={
                      item.severity === "urgent"
                        ? "h-4 w-4 shrink-0 text-destructive"
                        : item.severity === "warning"
                          ? "h-4 w-4 shrink-0 text-amber-600"
                          : "h-4 w-4 shrink-0 text-muted-foreground"
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", wall ? "text-sm" : "text-xs")}>
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                  {item.ownerId ? (
                    <UserChip
                      userId={item.ownerId}
                      size="xs"
                      className={cn("shrink-0", wall ? "max-w-[9rem]" : "max-w-[7.5rem]")}
                    />
                  ) : null}
                  {!wall ? (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                </>
              );
              return (
                <li key={item.id}>
                  {wall ? (
                    <div className={rowClass}>{body}</div>
                  ) : (
                    <Link href={item.href} className={rowClass}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
