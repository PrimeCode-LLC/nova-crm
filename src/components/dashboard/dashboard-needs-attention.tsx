import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, MailWarning, MessageSquareReply, Timer, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";

type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  time: number;
  severity: "urgent" | "warning" | "info";
  icon: typeof AlertTriangle;
};

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
  currentUserId,
}: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  currentUserId: string;
}) {
  const [now] = React.useState(() => Date.now());
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const leadLabel = (leadId: string | undefined) => {
    const lead = leadId ? leadById.get(leadId) : undefined;
    return lead?.companyName || lead?.contactName || "Unlinked item";
  };

  const items: AttentionItem[] = [];

  for (const followup of followups) {
    if (followup.completedAt || followup.pausedAt) continue;
    if (followup.deliveryStatus === "failed") {
      items.push({
        id: `failed-${followup.id}`,
        label: `Email failed · ${leadLabel(followup.leadId)}`,
        detail: followup.deliveryError || followup.title,
        href: followup.leadId ? `/leads/${followup.leadId}` : "/followups",
        time: timestamp(followup.failedAt, now),
        severity: "urgent",
        icon: MailWarning,
      });
      continue;
    }
    const due = timestamp(followup.dueAt, Number.POSITIVE_INFINITY);
    if (due < now) {
      items.push({
        id: `followup-${followup.id}`,
        label: `Overdue follow-up · ${leadLabel(followup.leadId)}`,
        detail: followup.title,
        href: followup.leadId ? `/leads/${followup.leadId}` : "/followups",
        time: due,
        severity: "warning",
        icon: Timer,
      });
    }
  }

  for (const task of tasks) {
    if (task.completedAt || task.assigneeId !== currentUserId || !task.dueAt) continue;
    const due = timestamp(task.dueAt, Number.POSITIVE_INFINITY);
    if (due >= now) continue;
    items.push({
      id: `task-${task.id}`,
      label: `Overdue task · ${leadLabel(task.leadId)}`,
      detail: task.title,
      href: "/tasks",
      time: due,
      severity: "warning",
      icon: ListTodo,
    });
  }

  for (const plan of plans) {
    if (plan.status !== "paused" || !plan.replyMessageId) continue;
    items.push({
      id: `plan-${plan.id}`,
      label: `Sequence stopped on reply · ${leadLabel(plan.leadId)}`,
      detail: plan.pausedReason || "Review the response before continuing outreach.",
      href: `/leads/${plan.leadId}`,
      time: timestamp(plan.pausedAt, now),
      severity: "info",
      icon: MessageSquareReply,
    });
  }

  for (const lead of leads) {
    if (lead.intakeKind === "prospect" || !lead.isIdle || ["won", "lost"].includes(lead.stage)) continue;
    items.push({
      id: `idle-${lead.id}`,
      label: `Idle lead · ${lead.companyName || lead.contactName}`,
      detail: lead.idleDays ? `No activity for ${lead.idleDays} days` : "No recent activity",
      href: `/leads/${lead.id}`,
      time: timestamp(lead.lastActivityAt || lead.updatedAt, now),
      severity: "info",
      icon: AlertTriangle,
    });
  }

  const severityRank = { urgent: 0, warning: 1, info: 2 };
  const visible = items
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.time - b.time)
    .slice(0, 8);

  return (
    <Card className="shrink-0">
      <CardHeader className="pb-3">
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
      <CardContent className="pt-0">
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {visible.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
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
                      <span className="block truncate text-xs font-medium">{item.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
