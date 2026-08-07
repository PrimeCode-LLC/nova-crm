"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clapperboard,
  MailWarning,
  MessageSquareReply,
  Sparkles,
  Timer,
  ListTodo,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserChip } from "@/components/common/user-chip";
import { cn } from "@/lib/utils";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";
import {
  CONTENT_CHECKLIST_STEP_LABELS,
  CONTENT_OPEN_STATUSES,
  type ContentItem,
} from "@/lib/content-calendar/types";
import { contactFirstName, leadEntityLabel } from "@/lib/leads/lead-display-label";
import { isLeadArchived } from "@/lib/leads/lead-archive";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import { hasPendingReplyAction } from "@/lib/email/reply-action-pending";
import { isFollowupOverdue } from "@/lib/followup-open-status";
import { useOrgTimezone } from "@/hooks/use-org-timezone";

/** Archived or closed (won/lost) leads should not surface on Needs attention. */
function isClosedOrArchivedLead(lead: Lead | undefined): boolean {
  if (!lead) return false;
  if (isLeadArchived(lead)) return true;
  return lead.stage === "won" || lead.stage === "lost";
}

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

function AttentionRow({
  item,
  wall,
  dense,
  onNavigate,
}: {
  item: AttentionItem;
  wall?: boolean;
  dense?: boolean;
  onNavigate?: () => void;
}) {
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
        <span
          className={cn(
            "block truncate font-medium",
            dense || wall ? "text-sm" : "text-xs",
          )}
        >
          {item.label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      {item.ownerId ? (
        <UserChip
          userId={item.ownerId}
          size="xs"
          className={cn("shrink-0", wall || dense ? "max-w-[9rem]" : "max-w-[7.5rem]")}
        />
      ) : null}
      {!wall ? (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );

  if (wall) {
    return <div className={rowClass}>{body}</div>;
  }

  return (
    <Link href={item.href} className={rowClass} onClick={onNavigate}>
      {body}
    </Link>
  );
}

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
  contentScope = "mine",
  currentUserId,
  wall,
  className,
}: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  /** Optional content calendar posts (checklist + overdue). */
  contentItems?: readonly ContentItem[];
  /** `mine` = assignee steps for current user; `team` = all open content work (owner/wall). */
  contentScope?: "mine" | "team";
  currentUserId: string;
  wall?: boolean;
  className?: string;
}) {
  const [now] = React.useState(() => Date.now());
  const [allOpen, setAllOpen] = React.useState(false);
  const timeZone = useOrgTimezone();
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const leadFor = (leadId: string | undefined) => (leadId ? leadById.get(leadId) : undefined);
  const leadLabel = (leadId: string | undefined) => leadEntityLabel(leadFor(leadId));

  const items: AttentionItem[] = [];

  for (const content of contentItems ?? []) {
    if (!CONTENT_OPEN_STATUSES.includes(content.status)) continue;

    const checklist = content.checklist ?? [];
    if (checklist.length > 0) {
      for (const step of checklist) {
        if (step.status !== "pending") continue;
        if (contentScope === "mine" && step.assigneeUserId !== currentUserId) continue;
        const due = timestamp(step.dueAt || content.dueAt, now);
        const overdue = due < now;
        items.push({
          id: `content-step-${content.id}-${step.key}`,
          label: `${CONTENT_CHECKLIST_STEP_LABELS[step.key]} · ${content.title}`,
          detail: content.angle.slice(0, 120),
          href: `/content/${content.id}`,
          time: due,
          severity: overdue ? "warning" : "info",
          icon: Clapperboard,
          ownerId: step.assigneeUserId || content.assigneeUserId || content.ownerUserId,
        });
      }
      continue;
    }

    // Legacy items without checklist: overdue assignee/owner only (or team overdue).
    if (contentScope === "mine") {
      if (content.assigneeUserId !== currentUserId && content.ownerUserId !== currentUserId) {
        continue;
      }
    }
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
    if (isClosedOrArchivedLead(lead)) continue;
    if (!hasPendingReplyReview(lead)) continue;
    const aiReady = hasPendingReplyAction(lead);
    items.push({
      id: `reply-${lead.id}`,
      label: `Reply to review · ${entityWithPerson(lead)}`,
      detail: aiReady
        ? lead.intakeKind === "prospect"
          ? "AI next step ready · promote/move to Replied when you send or confirm."
          : "AI next step ready · move to Replied when you send or confirm."
        : lead.intakeKind === "prospect"
          ? "Promote to lead or confirm Replied on the dashboard."
          : "Confirm moving this opportunity to Replied.",
      href: lead.intakeKind === "prospect" ? `/leads/${lead.id}?from=prospects` : `/leads/${lead.id}`,
      time: timestamp(lead.lastReplyAt || lead.lastActivityAt, now),
      severity: "urgent",
      icon: MessageSquareReply,
      ownerId: resolveOwnerId(lead),
    });
  }

  for (const lead of leads) {
    if (isClosedOrArchivedLead(lead)) continue;
    if (!hasPendingReplyAction(lead)) continue;
    // Already covered above when reply review is also pending.
    if (hasPendingReplyReview(lead)) continue;
    const hardNo = lead.replyClass === "hard_no";
    items.push({
      id: `reply-ai-${lead.id}`,
      label: hardNo
        ? `Hard no · ${entityWithPerson(lead)}`
        : `AI reply ready · ${entityWithPerson(lead)}`,
      detail: hardNo
        ? lead.nextAction?.trim() ||
          "Confirm do-not-contact and close as Lost — do not promote to Replied."
        : lead.nextAction?.trim() || "Review the suggested next step and send or dismiss.",
      href: lead.intakeKind === "prospect" ? `/leads/${lead.id}?from=prospects` : `/leads/${lead.id}`,
      time: timestamp(lead.lastReplyAt || lead.lastActivityAt, now),
      severity: "urgent",
      icon: Sparkles,
      ownerId: resolveOwnerId(lead),
    });
  }

  for (const followup of followups) {
    if (followup.completedAt || followup.pausedAt) continue;
    const lead = leadFor(followup.leadId);
    if (isClosedOrArchivedLead(lead)) continue;
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
    if (isFollowupOverdue(followup, { now: new Date(now), timeZone })) {
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
    if (isClosedOrArchivedLead(lead)) continue;
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
    if (isClosedOrArchivedLead(planLead)) continue;
    if (planLead && (hasPendingReplyReview(planLead) || hasPendingReplyAction(planLead))) continue;
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
    if (isClosedOrArchivedLead(lead)) continue;
    if (lead.intakeKind === "prospect" || !lead.isIdle) continue;
    if (hasPendingReplyReview(lead) || hasPendingReplyAction(lead)) continue;
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
  const sorted = [...items].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.time - b.time,
  );
  const visible = sorted.slice(0, limit);
  const hasMore = sorted.length > limit;
  const closeAll = () => setAllOpen(false);

  return (
    <>
      <Card className={cn("min-h-0 shrink-0", wall && "flex h-full flex-col", className)}>
        <CardHeader className={cn("pb-3", wall && "shrink-0")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Needs attention</CardTitle>
              <CardDescription className="mt-1">
                Exceptions and work that should be handled next.
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {sorted.length > 0 ? (
                hasMore ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 gap-1 rounded-full px-2.5 text-xs font-medium"
                    onClick={() => setAllOpen(true)}
                    aria-label={`See all ${sorted.length} items needing attention`}
                  >
                    {sorted.length}
                    <ChevronRight className="h-3 w-3 opacity-70" />
                  </Button>
                ) : (
                  <Badge variant="secondary">{sorted.length}</Badge>
                )
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn("pt-0", wall && "min-h-0 flex-1 overflow-y-auto")}>
          {visible.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {visible.map((item) => (
                <li key={item.id}>
                  <AttentionRow item={item} wall={wall} />
                </li>
              ))}
            </ul>
          )}
          {hasMore ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAllOpen(true)}
            >
              See all {sorted.length} items
              <ChevronRight className="h-3 w-3" />
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent
          showCloseButton
          className={cn(
            "flex h-[min(92vh,40rem)] w-[min(98vw,36rem)] max-w-[min(98vw,36rem)] flex-col gap-0 overflow-hidden p-0",
            "sm:max-w-[min(98vw,36rem)]",
          )}
        >
          <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12 text-left sm:px-6">
            <DialogTitle className="text-base">Needs attention</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {sorted.length} items · highest severity first
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <ul className="divide-y px-2 py-1 sm:px-3">
              {sorted.map((item) => (
                <li key={item.id}>
                  <AttentionRow item={item} wall={wall} dense onNavigate={closeAll} />
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
